"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  runNightlyBackup,
  rotateBackups,
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
});
