"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  runNightlyBackup,
  rotateBackups,
  startNightlyBackupCron,
  extractAllData,
  MANDATORY_TABLES,
} = require("../scripts/backup_nightly");
const { restoreBackup } = require("../scripts/restore_backup");
const { runRestoreDrill, createDrillMockContext } = require("../scripts/verify_restore_drill");

test("Story S-57: Sao lưu cơ sở dữ liệu hằng đêm và diễn tập khôi phục (Jira N2-125)", async (t) => {
  let tempBackupDir;

  t.beforeEach(() => {
    tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "s57-backup-test-"));
  });

  t.afterEach(() => {
    if (tempBackupDir && fs.existsSync(tempBackupDir)) {
      try {
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });

  await t.test(
    "N2-245: Sao lưu cơ sở dữ liệu, mã hóa AES-256-GCM, tính SHA-256 checksum và tạo manifest",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "test-secret-key-123456";

      const res = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      assert.equal(res.success, true);
      assert.ok(fs.existsSync(res.filePath), "Tệp backup phải được tạo trên đĩa");
      assert.ok(res.fileSize > 0, "Kích thước tệp backup phải > 0");
      assert.ok(res.plaintextSha256.length === 64, "Mã SHA-256 plaintext phải có 64 ký tự hex");
      assert.ok(res.ciphertextSha256.length === 64, "Mã SHA-256 ciphertext phải có 64 ký tự hex");

      // Kiểm tra manifest
      const manifestPath = path.join(tempBackupDir, "backup-manifest.json");
      assert.ok(fs.existsSync(manifestPath), "Tệp backup-manifest.json phải tồn tại");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(manifest.backups.length, 1);
      assert.equal(manifest.backups[0].filename, res.filename);
      assert.equal(manifest.backups[0].algorithm, "aes-256-gcm");
    }
  );

  await t.test(
    "N2-245: Quy tắc xoay vòng (Retention Policy) - Giữ tối đa 14 bản gần nhất, xóa bản cũ hơn",
    () => {
      // Giả lập tạo 18 tệp sao lưu với thời gian khác nhau
      const now = Date.now();
      for (let i = 1; i <= 18; i++) {
        const fname = `backup-coldchain-2026-10-${i.toString().padStart(2, "0")}.enc`;
        const fpath = path.join(tempBackupDir, fname);
        fs.writeFileSync(fpath, "dummy encrypted content");
        // Đặt mtime cách nhau 1 giờ
        const mtime = new Date(now - (18 - i) * 3600 * 1000);
        fs.utimesSync(fpath, mtime, mtime);
      }

      const filesBefore = fs.readdirSync(tempBackupDir).filter((f) => f.endsWith(".enc"));
      assert.equal(filesBefore.length, 18);

      // Chạy xoay vòng với giới hạn 14 bản
      const pruned = rotateBackups(tempBackupDir, 14);
      assert.equal(pruned.length, 4, "Phải xóa đúng 4 tệp cũ nhất");

      const filesAfter = fs.readdirSync(tempBackupDir).filter((f) => f.endsWith(".enc"));
      assert.equal(filesAfter.length, 14, "Chỉ còn đúng 14 bản sao lưu gần nhất");

      // Đảm bảo các bản mới nhất (ngày 05 đến 18) còn giữ lại, ngày 01 đến 04 bị xóa
      assert.ok(pruned.includes("backup-coldchain-2026-10-01.enc"));
      assert.ok(pruned.includes("backup-coldchain-2026-10-02.enc"));
      assert.ok(pruned.includes("backup-coldchain-2026-10-03.enc"));
      assert.ok(pruned.includes("backup-coldchain-2026-10-04.enc"));
      assert.ok(filesAfter.includes("backup-coldchain-2026-10-18.enc"));
    }
  );

  await t.test(
    "N2-287: Script phục hồi giải mã thành công và đối soát chuỗi hash toàn vẹn",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "correct-password-s57!";

      const backupRes = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      const sandboxTarget = {};
      const restoreRes = await restoreBackup(backupRes.filePath, {
        encryptionKey: secret,
        targetInMemory: sandboxTarget,
        skipVerification: false,
      });

      assert.equal(restoreRes.success, true);
      assert.equal(sandboxTarget.inMemoryLots.length, 2);
      assert.equal(sandboxTarget.inMemoryBatchEvents.length, 2);
      assert.equal(restoreRes.integrityVerification.checked, true);
      assert.equal(restoreRes.integrityVerification.passed, true);
      assert.ok(restoreRes.elapsedMs >= 0);
    }
  );

  await t.test(
    "N2-287 / Bảo mật: Chặn đứng phục hồi khi mật khẩu sai hoặc tệp bị can thiệp (Tampering)",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "correct-password-s57!";

      const backupRes = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      // 1. Phục hồi với mật khẩu sai -> Ném lỗi giải mã
      await assert.rejects(
        async () => {
          await restoreBackup(backupRes.filePath, {
            encryptionKey: "wrong-password-attacker",
            targetInMemory: {},
          });
        },
        /Giải mã thất bại/
      );

      // 2. Tệp bị can thiệp (sửa đổi ciphertext) -> AES-256-GCM authTag từ chối
      const fileContent = JSON.parse(fs.readFileSync(backupRes.filePath, "utf8"));
      // Sửa đổi 1 byte trong ciphertext
      const tamperedBytes = Buffer.from(fileContent.ciphertext, "base64");
      tamperedBytes[0] = tamperedBytes[0] ^ 0xff; // Đảo bit
      fileContent.ciphertext = tamperedBytes.toString("base64");
      
      const tamperedFilePath = path.join(tempBackupDir, "tampered-backup.enc");
      fs.writeFileSync(tamperedFilePath, JSON.stringify(fileContent), "utf8");

      await assert.rejects(
        async () => {
          await restoreBackup(tamperedFilePath, {
            encryptionKey: secret,
            targetInMemory: {},
          });
        },
        /Giải mã thất bại/
      );
    }
  );

  await t.test(
    "N2-246: Diễn tập khôi phục bản sao lưu lên môi trường tạm, đo thời gian gián đoạn RTO",
    async () => {
      const drillReport = await runRestoreDrill();
      assert.equal(drillReport.status, "DRILL_PASSED");
      assert.ok(drillReport.rtoDurationMs >= 0, "Phải đo lường thời gian khôi phục RTO");
      assert.ok(drillReport.rtoDurationSeconds < 300, "Thời gian khôi phục RTO phải < 5 phút");
      assert.equal(drillReport.checks.lotsParity, true);
      assert.equal(drillReport.checks.eventsParity, true);
      assert.equal(drillReport.checks.hashIntegrityPassed, true);
    }
  );

  await t.test(
    "Bảo mật: Bắt buộc cấu hình BACKUP_ENCRYPTION_KEY an toàn và từ chối khóa quá ngắn (< 16 ký tự)",
    async () => {
      const prevEnv = process.env.BACKUP_ENCRYPTION_KEY;
      try {
        delete process.env.BACKUP_ENCRYPTION_KEY;

        // 1. Không truyền khóa -> ném lỗi bắt buộc cấu hình
        await assert.rejects(
          async () => {
            await runNightlyBackup({ backupDir: tempBackupDir });
          },
          /Bắt buộc cấu hình BACKUP_ENCRYPTION_KEY/
        );

        // 2. Khóa quá ngắn (< 16 ký tự) -> ném lỗi bảo mật
        await assert.rejects(
          async () => {
            await runNightlyBackup({ backupDir: tempBackupDir, encryptionKey: "12345" });
          },
          /Khóa BACKUP_ENCRYPTION_KEY phải có độ dài tối thiểu 16 ký tự/
        );
      } finally {
        if (prevEnv) process.env.BACKUP_ENCRYPTION_KEY = prevEnv;
      }
    }
  );

  await t.test(
    "Độ tin cậy: Không cho phép backup báo SUCCESS nếu truy vấn bảng thất bại",
    async () => {
      const failingPool = {
        query: async (sql) => {
          if (sql.includes("lots")) {
            throw new Error("Mất kết nối mạng tới cụm cơ sở dữ liệu");
          }
          return { rows: [] };
        },
      };

      await assert.rejects(
        async () => {
          await runNightlyBackup({
            backupDir: tempBackupDir,
            encryptionKey: "secure-test-key-minimum-16-chars",
            pool: failingPool,
          });
        },
        /Truy vấn bảng 'lots' thất bại/
      );
    }
  );

  await t.test(
    "Bảo vệ dữ liệu: Chống thao tác restore nhầm vào Production khi thiếu cờ xác nhận",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "secure-production-guard-key-16";

      const backupRes = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";

        // Thao tác khôi phục không có cờ allowProduction -> Bị từ chối ngay lập tức
        await assert.rejects(
          async () => {
            await restoreBackup(backupRes.filePath, {
              encryptionKey: secret,
              targetInMemory: {},
            });
          },
          /Thao tác khôi phục bị từ chối.*Production/
        );

        // Có cờ allowProduction -> Khôi phục an toàn
        const allowedRes = await restoreBackup(backupRes.filePath, {
          encryptionKey: secret,
          targetInMemory: {},
          allowProduction: true,
        });
        assert.equal(allowedRes.success, true);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    }
  );

  await t.test(
    "Toàn vẹn Transaction: Khôi phục qua PostgreSQL tuân thủ thứ tự khóa ngoại và ROLLBACK nếu lỗi",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "secure-transaction-key-16-bytes";

      const backupRes = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      const executedQueries = [];
      let txStatus = null;

      const mockPgClient = {
        query: async (sql, _params) => {
          executedQueries.push(sql);
          if (sql === "BEGIN;") txStatus = "IN_TRANSACTION";
          if (sql === "COMMIT;") txStatus = "COMMITTED";
          if (sql === "ROLLBACK;") txStatus = "ROLLED_BACK";
          if (sql.includes("lots") && sql.includes("INSERT")) {
            throw new Error("Lỗi vi phạm ràng buộc dữ liệu tại bảng lots");
          }
          return { rowCount: 1 };
        },
        release: () => {},
      };

      const mockPool = {
        connect: async () => mockPgClient,
      };

      await assert.rejects(
        async () => {
          await restoreBackup(backupRes.filePath, {
            encryptionKey: secret,
            pool: mockPool,
          });
        },
        /Restore Transaction Rollback/
      );

      assert.equal(txStatus, "ROLLED_BACK", "Giao dịch phải được ROLLBACK an toàn khi có lỗi");
      assert.ok(executedQueries.includes("BEGIN;"), "Phải khởi tạo BEGIN transaction");
      assert.ok(executedQueries.includes("ROLLBACK;"), "Phải thực thi lệnh ROLLBACK");
    }
  );

  await t.test(
    "S-57 Production Guard: Chặn sao lưu ở chế độ production khi không có DATABASE_URL",
    async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;
      try {
        process.env.NODE_ENV = "production";
        delete process.env.DATABASE_URL;

        await assert.rejects(
          async () => {
            await runNightlyBackup({
              backupDir: tempBackupDir,
              encryptionKey: "secure-key-16-bytes!",
              pool: null,
            });
          },
          /BẢO MẬT PRODUCTION/
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevDbUrl) process.env.DATABASE_URL = prevDbUrl;
      }
    }
  );

  await t.test(
    "S-57 Data Integrity Guard: Từ chối tạo file backup rỗng khi context rỗng hoặc không có dữ liệu bắt buộc",
    async () => {
      // 1. Không có pool và không có dữ liệu in-memory -> Thất bại ngay
      await assert.rejects(
        async () => {
          await runNightlyBackup({
            backupDir: tempBackupDir,
            encryptionKey: "secure-key-16-bytes!",
            inMemoryContext: {},
          });
        },
        /Không có kết nối database và không có dữ liệu nguồn/
      );

      // 2. Không được tạo file rỗng và báo SUCCESS khi các bảng bắt buộc rỗng
      await assert.rejects(
        async () => {
          await runNightlyBackup({
            backupDir: tempBackupDir,
            encryptionKey: "secure-key-16-bytes!",
            inMemoryContext: {
              inMemoryOrgs: [],
              inMemoryLots: [],
              inMemoryBatchEvents: [],
            },
          });
        },
        /Không tạo file backup rỗng rồi báo SUCCESS/
      );
    }
  );

  await t.test(
    "S-57 Mandatory Tables: Ném lỗi nghiêm trọng khi bảng bắt buộc cốt lõi bị thiếu hoặc không tồn tại",
    async () => {
      assert.ok(Array.isArray(MANDATORY_TABLES) && MANDATORY_TABLES.includes("lots"));
      const mockPoolMissingMandatory = {
        query: async (sql) => {
          if (sql.includes("lots") || sql.includes("batch_events")) {
            const err = new Error('relation "lots" does not exist');
            err.code = "42P01";
            throw err;
          }
          return { rows: [] };
        },
      };

      await assert.rejects(
        async () => {
          await extractAllData({ pool: mockPoolMissingMandatory });
        },
        /Bảng bắt buộc 'lots' chưa tồn tại hoặc bị thiếu/
      );
    }
  );

  await t.test(
    "S-57 Nightly Backup Cron: Khởi tạo và dừng cron job sao lưu tự động ban đêm thành công",
    () => {
      const task = startNightlyBackupCron({
        cronExpression: "0 2 * * *",
        backupDir: tempBackupDir,
        encryptionKey: "secure-key-16-bytes!",
      });

      assert.ok(task, "Phải khởi tạo thành công cron task");
      assert.equal(typeof task.stop, "function", "Task phải có hàm stop");
      task.stop(); // Hủy task sau test
    }
  );
});
