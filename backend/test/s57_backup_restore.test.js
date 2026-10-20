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
const {
  runRestoreDrill,
  createDrillMockContext,
  verifyForeignKeys,
  verifyWrongKeyScenario,
  verifyTamperedCiphertextScenario,
  verifyTamperedAuthTagScenario,
  verifyTransactionRollbackScenario,
} = require("../scripts/verify_restore_drill");
const request = require("supertest");
const { app, seedDemoUser } = require("../src/server");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

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
    "N2-287: Script phục hồi giải mã thành công, đối chiếu đầy đủ bản ghi từng bảng, khóa ngoại và chuỗi hash",
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
      // Đối soát số lượng từng bảng
      assert.equal(sandboxTarget.inMemoryOrgs.length, mockContext.inMemoryOrgs.length);
      assert.equal(sandboxTarget.inMemoryFarms.length, mockContext.inMemoryFarms.length);
      assert.equal(sandboxTarget.inMemoryLots.length, mockContext.inMemoryLots.length);
      assert.equal(sandboxTarget.inMemoryBatchEvents.length, mockContext.inMemoryBatchEvents.length);
      assert.equal(sandboxTarget.inMemoryShipments.length, mockContext.inMemoryShipments.length);
      assert.equal(sandboxTarget.inMemoryViolations.length, mockContext.inMemoryViolations.length);
      assert.equal(
        sandboxTarget.inMemoryAnonymizationRequests.length,
        mockContext.inMemoryAnonymizationRequests.length
      );

      // Đối soát ràng buộc khóa ngoại giữa các thực thể đã phục hồi
      const fkCheck = verifyForeignKeys(sandboxTarget);
      assert.equal(fkCheck.valid, true, "Ràng buộc khóa ngoại phải hoàn toàn hợp lệ");

      // Đối soát chuỗi hash mật mã
      assert.equal(restoreRes.integrityVerification.checked, true);
      assert.equal(restoreRes.integrityVerification.passed, true);
      assert.equal(restoreRes.integrityVerification.totalLotsChecked, 1);
      assert.ok(restoreRes.elapsedMs >= 0);
    }
  );

  await t.test(
    "N2-287 / Ngoại lệ: Chặn đứng phục hồi khi mật khẩu sai hoặc tệp bị can thiệp (Tampering)",
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
      const wrongKeyDrill = await verifyWrongKeyScenario(backupRes.filePath);
      assert.equal(wrongKeyDrill.passed, true, "Hàm diễn tập phải bắt được lỗi sai khóa");

      // 2. Tệp bị can thiệp (sửa đổi ciphertext) -> AES-256-GCM authTag từ chối
      const fileContent = JSON.parse(fs.readFileSync(backupRes.filePath, "utf8"));
      const tamperedBytes = Buffer.from(fileContent.ciphertext, "base64");
      tamperedBytes[0] = tamperedBytes[0] ^ 0xff; // Đảo bit ciphertext
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
      const tamperedCipherDrill = await verifyTamperedCiphertextScenario(
        backupRes.filePath,
        secret,
        tempBackupDir
      );
      assert.equal(tamperedCipherDrill.passed, true, "Hàm diễn tập phải bắt được ciphertext bị sửa đổi");

      // 3. Tệp bị can thiệp authTag trong metadata -> AES-256-GCM từ chối
      const authTagContent = JSON.parse(fs.readFileSync(backupRes.filePath, "utf8"));
      const originalTag = authTagContent.metadata.authTag || "";
      authTagContent.metadata.authTag = (originalTag[0] === "a" ? "b" : "a") + originalTag.slice(1);
      const tamperedTagPath = path.join(tempBackupDir, "tampered-tag-backup.enc");
      fs.writeFileSync(tamperedTagPath, JSON.stringify(authTagContent), "utf8");

      await assert.rejects(
        async () => {
          await restoreBackup(tamperedTagPath, {
            encryptionKey: secret,
            targetInMemory: {},
          });
        },
        /Giải mã thất bại/
      );
      const tamperedTagDrill = await verifyTamperedAuthTagScenario(
        backupRes.filePath,
        secret,
        tempBackupDir
      );
      assert.equal(tamperedTagDrill.passed, true, "Hàm diễn tập phải bắt được authTag bị sửa đổi");

      // 4. Tệp bị sửa đổi plaintextSha256 -> Phát hiện SHA-256 checksum không khớp
      const shaTamperedContent = JSON.parse(fs.readFileSync(backupRes.filePath, "utf8"));
      shaTamperedContent.metadata.plaintextSha256 = "0".repeat(64);
      const tamperedShaPath = path.join(tempBackupDir, "tampered-sha-backup.enc");
      fs.writeFileSync(tamperedShaPath, JSON.stringify(shaTamperedContent), "utf8");

      await assert.rejects(
        async () => {
          await restoreBackup(tamperedShaPath, {
            encryptionKey: secret,
            targetInMemory: {},
          });
        },
        /Checksum SHA-256 không khớp/
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
      assert.equal(drillReport.checks.orgsParity, true);
      assert.equal(drillReport.checks.farmsParity, true);
      assert.equal(drillReport.checks.lotsParity, true);
      assert.equal(drillReport.checks.eventsParity, true);
      assert.equal(drillReport.checks.shipmentsParity, true);
      assert.equal(drillReport.checks.violationsParity, true);
      assert.equal(drillReport.checks.anonymizationParity, true);
      assert.equal(drillReport.checks.foreignKeysValid, true);
      assert.equal(drillReport.checks.hashIntegrityPassed, true);
      assert.equal(drillReport.exceptionScenarios.wrongKey.passed, true);
      assert.equal(drillReport.exceptionScenarios.tamperedCiphertext.passed, true);
      assert.equal(drillReport.exceptionScenarios.tamperedAuthTag.passed, true);
      assert.equal(drillReport.exceptionScenarios.transactionRollback.passed, true);
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
      const prevConfirm = process.env.CONFIRM_PRODUCTION_RESTORE;
      try {
        process.env.NODE_ENV = "production";
        delete process.env.CONFIRM_PRODUCTION_RESTORE;

        // 1. Thao tác khôi phục không có xác nhận -> Bị từ chối ngay lập tức
        await assert.rejects(
          async () => {
            await restoreBackup(backupRes.filePath, {
              encryptionKey: secret,
              targetInMemory: {},
            });
          },
          /Thao tác khôi phục bị từ chối.*Production/
        );

        // 2. Có biến môi trường CONFIRM_PRODUCTION_RESTORE=true -> Cho phép khôi phục
        process.env.CONFIRM_PRODUCTION_RESTORE = "true";
        const envAllowedRes = await restoreBackup(backupRes.filePath, {
          encryptionKey: secret,
          targetInMemory: {},
        });
        assert.equal(envAllowedRes.success, true);

        // 3. Có cờ allowProduction: true -> Cho phép khôi phục
        delete process.env.CONFIRM_PRODUCTION_RESTORE;
        const allowedRes = await restoreBackup(backupRes.filePath, {
          encryptionKey: secret,
          targetInMemory: {},
          allowProduction: true,
        });
        assert.equal(allowedRes.success, true);

        // 4. Có cờ confirmProductionRestore: true -> Cho phép khôi phục
        const confirmFlagRes = await restoreBackup(backupRes.filePath, {
          encryptionKey: secret,
          targetInMemory: {},
          confirmProductionRestore: true,
        });
        assert.equal(confirmFlagRes.success, true);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevConfirm !== undefined) {
          process.env.CONFIRM_PRODUCTION_RESTORE = prevConfirm;
        } else {
          delete process.env.CONFIRM_PRODUCTION_RESTORE;
        }
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

      // Kiểm thử thêm qua hàm helper chuyên dụng verifyTransactionRollbackScenario
      const rollbackDrill = await verifyTransactionRollbackScenario(backupRes.filePath, secret);
      assert.equal(rollbackDrill.passed, true);
      assert.equal(rollbackDrill.beginExecuted, true);
      assert.equal(rollbackDrill.rollbackExecuted, true);
      assert.equal(rollbackDrill.errorCaught, true);
    }
  );

  await t.test(
    "S-57 Transaction Rollback & Hash Integrity: Tự động ROLLBACK khi chuỗi hash bị sai lệch và enforceIntegrity=true",
    async () => {
      const mockContext = createDrillMockContext();
      const secret = "secure-hash-rollback-key-16";

      // Tạo một sự kiện có hash giả mạo
      mockContext.inMemoryBatchEvents[1].eventHash = "f".repeat(64);

      const backupRes = await runNightlyBackup({
        backupDir: tempBackupDir,
        encryptionKey: secret,
        inMemoryContext: mockContext,
      });

      let txStatus = null;
      const mockPgClient = {
        query: async (sql) => {
          if (sql === "BEGIN;") txStatus = "IN_TRANSACTION";
          if (sql === "COMMIT;") txStatus = "COMMITTED";
          if (sql === "ROLLBACK;") txStatus = "ROLLED_BACK";
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
            enforceIntegrity: true,
          });
        },
        /Lỗi toàn vẹn chuỗi hash/
      );

      assert.equal(txStatus, "ROLLED_BACK", "Phải ROLLBACK giao dịch khi phát hiện chuỗi hash bị sai lệch");
    }
  );

  await t.test(
    "S-57 Disaster Recovery Drill: Đo RTO và kiểm tra cấu trúc file báo cáo bằng chứng docs/DRILL_RESTORE_EVIDENCE.json",
    async () => {
      const drillReport = await runRestoreDrill();
      assert.equal(drillReport.status, "DRILL_PASSED");
      assert.ok(drillReport.rtoDurationMs >= 0);
      assert.ok(drillReport.rtoDurationSeconds < 300);

      const evidencePath = path.resolve(__dirname, "../../docs/DRILL_RESTORE_EVIDENCE.json");
      assert.ok(fs.existsSync(evidencePath), "File DRILL_RESTORE_EVIDENCE.json phải được tạo trong thư mục docs");

      const fileData = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      assert.equal(fileData.drillId, drillReport.drillId);
      assert.equal(fileData.status, "DRILL_PASSED");
      assert.ok(fileData.rtoDurationSeconds !== undefined);
      assert.ok(fileData.rpoPoint.endsWith(".enc"));

      // Kiểm tra đầy đủ bảng và khóa ngoại
      assert.equal(fileData.checks.orgsParity, true);
      assert.equal(fileData.checks.farmsParity, true);
      assert.equal(fileData.checks.lotsParity, true);
      assert.equal(fileData.checks.eventsParity, true);
      assert.equal(fileData.checks.shipmentsParity, true);
      assert.equal(fileData.checks.violationsParity, true);
      assert.equal(fileData.checks.anonymizationParity, true);
      assert.equal(fileData.checks.foreignKeysValid, true);
      assert.equal(fileData.checks.hashIntegrityPassed, true);

      // Kiểm tra các kịch bản ngoại lệ trong file bằng chứng
      assert.equal(fileData.exceptionScenarios.wrongKey.passed, true);
      assert.equal(fileData.exceptionScenarios.tamperedCiphertext.passed, true);
      assert.equal(fileData.exceptionScenarios.tamperedAuthTag.passed, true);
      assert.equal(fileData.exceptionScenarios.transactionRollback.passed, true);
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

  await t.test(
    "S-57 PostgreSQL Advisory Lock: Bỏ qua sao lưu khi có replica khác đang nắm giữ lock",
    async () => {
      const mockContext = createDrillMockContext();
      let queryCount = 0;
      const mockLockedPool = {
        connect: async () => ({
          query: async (sql) => {
            queryCount++;
            if (sql.includes("pg_try_advisory_lock")) {
              return { rows: [{ locked: false }] };
            }
            return { rows: [] };
          },
          release: () => {},
        }),
      };

      const res = await runNightlyBackup({
        pool: mockLockedPool,
        backupDir: tempBackupDir,
        encryptionKey: "secure-key-16-bytes!",
        inMemoryContext: mockContext,
      });

      assert.equal(res.success, false);
      assert.equal(res.skipped, true);
      assert.equal(res.reason, "ADVISORY_LOCK_HELD");
      assert.match(res.message, /replica khác đang thực hiện sao lưu/i);
      assert.ok(queryCount > 0, "Phải thực thi truy vấn kiểm tra advisory lock");

      // Đảm bảo không tạo file backup nào
      const files = fs.readdirSync(tempBackupDir).filter((f) => f.endsWith(".enc"));
      assert.equal(files.length, 0, "Không được tạo tệp backup khi lock bận");
    }
  );

  await t.test(
    "S-57 PostgreSQL Advisory Lock: Hoàn tất sao lưu và giải phóng advisory lock trong finally",
    async () => {
      const mockContext = createDrillMockContext();
      const queries = [];
      const mockClient = {
        query: async (sql) => {
          queries.push(sql);
          if (sql.includes("pg_try_advisory_lock")) {
            return { rows: [{ locked: true }] };
          }
          if (sql.includes("pg_advisory_unlock")) {
            return { rows: [{ unlocked: true }] };
          }
          if (sql.includes("organizations") || sql.includes("lots") || sql.includes("batch_events")) {
            return { rows: [{ id: "test-rec", name: "test" }] };
          }
          return { rows: [] };
        },
        release: () => {},
      };

      const mockPool = {
        connect: async () => mockClient,
      };

      const res = await runNightlyBackup({
        pool: mockPool,
        backupDir: tempBackupDir,
        encryptionKey: "secure-key-16-bytes!",
        inMemoryContext: mockContext,
      });

      assert.equal(res.success, true);
      assert.ok(queries.some((q) => q.includes("pg_try_advisory_lock")), "Phải thử lấy advisory lock");
      assert.ok(queries.some((q) => q.includes("pg_advisory_unlock")), "Phải giải phóng advisory lock");
    }
  );

  await t.test(
    "S-57 API GET /api/admin/backup-status: RBAC và trả về thông tin manifest chính xác",
    async () => {
      await seedDemoUser();
      const originalBackupDir = process.env.BACKUP_DIR;
      process.env.BACKUP_DIR = tempBackupDir;

      try {
        // 1. Chưa đăng nhập -> 401
        const unauthRes = await request(app).get("/api/admin/backup-status");
        assert.equal(unauthRes.status, 401);

        // 2. User bình thường -> 403
        const userAgent = await loginAs("user@example.com");
        const forbiddenRes = await userAgent.get("/api/admin/backup-status");
        assert.equal(forbiddenRes.status, 403);

        // 3. Admin khi chưa có backup nào -> 200, NOT_INITIALIZED
        const adminAgent = await loginAs("admin@example.com");
        const emptyRes = await adminAgent.get("/api/admin/backup-status");
        assert.equal(emptyRes.status, 200);
        assert.equal(emptyRes.body.status, "OK");
        assert.equal(emptyRes.body.manifestExists, false);
        assert.equal(emptyRes.body.totalBackups, 0);

        // 4. Tạo một bản backup
        const mockContext = createDrillMockContext();
        const backupResult = await runNightlyBackup({
          backupDir: tempBackupDir,
          encryptionKey: "secure-key-16-bytes!",
          inMemoryContext: mockContext,
        });

        // 5. Admin gọi lại -> 200, thấy manifest và latestBackup
        const populatedRes = await adminAgent.get("/api/admin/backup-status");
        assert.equal(populatedRes.status, 200);
        assert.equal(populatedRes.body.status, "OK");
        assert.equal(populatedRes.body.manifestExists, true);
        assert.equal(populatedRes.body.totalBackups, 1);
        assert.equal(populatedRes.body.lastStatus, "SUCCESS");
        assert.equal(populatedRes.body.latestBackup.filename, backupResult.filename);
        assert.ok(populatedRes.body.manifest.backups.length >= 1);
      } finally {
        if (originalBackupDir) {
          process.env.BACKUP_DIR = originalBackupDir;
        } else {
          delete process.env.BACKUP_DIR;
        }
      }
    }
  );
});
