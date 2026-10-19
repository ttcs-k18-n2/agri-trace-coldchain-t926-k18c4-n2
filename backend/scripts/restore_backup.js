"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { deriveKey, getEncryptionKey } = require("./backup_nightly");
const { verifyBatchEventChain } = require("../src/integrity_verifier");

const RESTORE_TABLE_ORDER = [
  "organizations",
  "users",
  "products",
  "farms",
  "lots",
  "batch_events",
  "lot_transfers",
  "lot_relations",
  "cold_boxes",
  "shipments",
  "shipment_lots",
  "temperature_readings",
  "cold_chain_violations",
  "temperature_hourly_aggregates",
  "recall_orders",
  "recall_acknowledgments",
  "audit_logs",
  "public_lot_cache",
  "public_lot_rate_limits",
  "integrity_audit_jobs",
  "integrity_audit_logs",
  "farmer_anonymization_requests",
];

/**
 * Giải mã payload AES-256-GCM
 */
function decryptData(ciphertextBase64, ivHex, authTagHex, keyBuffer) {
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Khôi phục cơ sở dữ liệu từ tệp sao lưu mã hóa
 */
async function restoreBackup(filePath, options = {}) {
  const encryptionKey = getEncryptionKey(options.encryptionKey);
  const pool = options.pool || null;
  const targetInMemory = options.targetInMemory || null;
  const skipVerification = options.skipVerification || false;

  // BẢO VỆ CHỐNG RESTORE NHẦM VÀO PRODUCTION
  const isProduction =
    process.env.NODE_ENV === "production" ||
    (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes("prod") || process.env.DATABASE_URL.includes("live")));

  if (isProduction && !options.allowProduction && process.env.CONFIRM_PRODUCTION_RESTORE !== "true") {
    throw new Error(
      "[BẢO VỆ PRODUCTION] Thao tác khôi phục bị từ chối! Không được khôi phục đè vào môi trường Production mà không có cờ xác nhận 'allowProduction' hoặc biến môi trường CONFIRM_PRODUCTION_RESTORE=true."
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Tệp sao lưu không tồn tại: ${filePath}`);
  }

  const startTime = Date.now();
  const fileContent = fs.readFileSync(filePath, "utf8");
  let envelope;
  try {
    envelope = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(`Định dạng tệp sao lưu không hợp lệ: ${err.message}`);
  }

  if (!envelope.metadata || !envelope.ciphertext) {
    throw new Error("Tệp sao lưu thiếu metadata hoặc ciphertext");
  }

  const keyBuffer = deriveKey(encryptionKey);

  // Giải mã AES-256-GCM (tự động kiểm tra tính xác thực authTag)
  let plaintext;
  try {
    plaintext = decryptData(
      envelope.ciphertext,
      envelope.metadata.iv,
      envelope.metadata.authTag,
      keyBuffer
    );
  } catch (err) {
    throw new Error(`Giải mã thất bại - Dữ liệu bị giả mạo hoặc khóa không khớp: ${err.message}`);
  }

  // Kiểm tra SHA-256 Checksum
  const computedPlaintextSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");
  if (
    envelope.metadata.plaintextSha256 &&
    computedPlaintextSha256 !== envelope.metadata.plaintextSha256
  ) {
    throw new Error(
      `Checksum SHA-256 không khớp! Kỳ vọng: ${envelope.metadata.plaintextSha256}, Thực tế: ${computedPlaintextSha256}`
    );
  }

  const restoredData = JSON.parse(plaintext);
  const tableCounts = {};

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");

      // 1. Xóa sạch các bảng theo thứ tự ngược lại (Tránh lỗi khóa ngoại)
      for (let i = RESTORE_TABLE_ORDER.length - 1; i >= 0; i--) {
        const table = RESTORE_TABLE_ORDER[i];
        try {
          await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
        } catch (truncErr) {
          if (truncErr.code !== "42P01" && !truncErr.message.includes("does not exist")) {
            throw truncErr;
          }
        }
      }

      // 2. Nạp dữ liệu theo đúng thứ tự phụ thuộc khóa ngoại (Forward Order)
      for (const table of RESTORE_TABLE_ORDER) {
        const rows = restoredData.tables ? restoredData.tables[table] : null;
        if (!Array.isArray(rows) || rows.length === 0) {
          tableCounts[table] = 0;
          continue;
        }

        for (const row of rows) {
          const keys = Object.keys(row);
          const values = Object.values(row);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
          const quotedColumns = keys.map((k) => `"${k}"`).join(", ");
          try {
            await client.query(
              `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders});`,
              values
            );
          } catch (insertErr) {
            if (insertErr.code !== "42P01" && !insertErr.message.includes("does not exist")) {
              throw new Error(`[Restore Error at ${table}]: ${insertErr.message}`);
            }
          }
        }
        tableCounts[table] = rows.length;
      }

      await client.query("COMMIT;");
    } catch (txErr) {
      await client.query("ROLLBACK;");
      throw new Error(`[Restore Transaction Rollback] Khôi phục thất bại, đã hoàn tác: ${txErr.message}`);
    } finally {
      client.release();
    }
  }

  // Khôi phục vào đối tượng in-memory (Dùng cho kiểm thử biệt lập / Sandbox Drill)
  if (targetInMemory && typeof targetInMemory === "object") {
    const t = restoredData.tables || {};
    targetInMemory.inMemoryOrgs = t.organizations || [];
    targetInMemory.inMemoryProducts = t.products || [];
    targetInMemory.inMemoryFarms = t.farms || [];
    targetInMemory.inMemoryLots = t.lots || [];
    targetInMemory.inMemoryBatchEvents = t.batch_events || [];
    targetInMemory.inMemoryTransfers = t.lot_transfers || [];
    targetInMemory.inMemoryBatchRelations = t.lot_relations || [];
    targetInMemory.inMemoryColdBoxes = t.cold_boxes || [];
    targetInMemory.inMemoryShipments = t.shipments || [];
    targetInMemory.inMemoryShipmentLots = t.shipment_lots || [];
    targetInMemory.inMemoryReadings = t.temperature_readings || [];
    targetInMemory.inMemoryViolations = t.cold_chain_violations || [];
    targetInMemory.inMemoryRecallOrders = t.recall_orders || [];
    targetInMemory.inMemoryRecallAcknowledgments = t.recall_acknowledgments || [];
    targetInMemory.inMemoryAuditLogs = t.audit_logs || [];
    targetInMemory.inMemoryAggregates = t.temperature_hourly_aggregates || [];
    targetInMemory.inMemoryIntegrityJobs = t.integrity_audit_jobs || [];
    targetInMemory.inMemoryIntegrityLogs = t.integrity_audit_logs || [];
    targetInMemory.inMemoryAnonymizationRequests = t.farmer_anonymization_requests || [];

    for (const [k, v] of Object.entries(t)) {
      tableCounts[k] = Array.isArray(v) ? v.length : 0;
    }
  }

  // 3. Đối soát tính toàn vẹn chuỗi Hash mật mã sau khi phục hồi
  let integrityVerification = { checked: false, passed: true };
  if (!skipVerification) {
    const rawEvents = (restoredData.tables && restoredData.tables.batch_events) || [];
    const eventsByBatch = {};
    for (const ev of rawEvents) {
      const bId = ev.batch_id || ev.batchId || ev.lot_id;
      if (!eventsByBatch[bId]) eventsByBatch[bId] = [];
      eventsByBatch[bId].push(ev);
    }

    const checks = [];
    for (const [lotId, evList] of Object.entries(eventsByBatch)) {
      evList.sort(
        (a, b) =>
          Number(a.sequence_no !== undefined ? a.sequence_no : a.sequenceNo) -
          Number(b.sequence_no !== undefined ? b.sequence_no : b.sequenceNo)
      );
      const verifyRes = verifyBatchEventChain(evList);
      checks.push({ lotId, valid: verifyRes.valid, error: verifyRes.error || null });
    }

    integrityVerification = {
      checked: true,
      totalLotsChecked: checks.length,
      passed: checks.every((c) => c.valid),
      details: checks,
    };
  }

  const elapsedMs = Date.now() - startTime;

  return {
    success: true,
    restoredFrom: filePath,
    backupCreatedAt: envelope.metadata.createdAt,
    tableCounts,
    integrityVerification,
    elapsedMs,
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Cách dùng: node restore_backup.js <duong-dan-tep-backup.enc> [--allow-production]");
    process.exit(1);
  }

  let pool = null;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const { Pool } = require("pg");
      pool = new Pool({ connectionString: dbUrl });
      console.log("[Restore S-57 CLI] Đã khởi tạo kết nối PostgreSQL với:", dbUrl.replace(/:[^:@]+@/, ":***@"));
    } catch (pgErr) {
      console.warn("[Restore S-57 CLI] Không thể khởi tạo pg Pool:", pgErr.message);
    }
  } else {
    console.warn("[Restore S-57 CLI Warning] DATABASE_URL không được cấu hình. Chạy ở chế độ Standalone / Mock.");
  }

  const allowProduction =
    process.argv.includes("--allow-production") || process.env.CONFIRM_PRODUCTION_RESTORE === "true";

  restoreBackup(filePath, { pool, allowProduction })
    .then((res) => {
      console.log("[Restore S-57] Khôi phục thành công:");
      console.log(JSON.stringify(res, null, 2));
      if (pool) {
        pool.end().catch(() => {});
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Restore S-57 Error]:", err.message);
      if (pool) {
        pool.end().catch(() => {});
      }
      process.exit(1);
    });
}

module.exports = {
  restoreBackup,
  decryptData,
  RESTORE_TABLE_ORDER,
};
