"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { deriveKey } = require("./backup_nightly");
const { verifyBatchEventChain } = require("../src/integrity_verifier");

const DEFAULT_KEY_SECRET = process.env.BACKUP_ENCRYPTION_KEY || "agri-trace-coldchain-backup-master-key-2026!";

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
  const encryptionKey = options.encryptionKey || DEFAULT_KEY_SECRET;
  const pool = options.pool || null;
  const targetInMemory = options.targetInMemory || null;
  const skipVerification = options.skipVerification || false;

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
      await client.query("BEGIN");
      for (const [table, rows] of Object.entries(restoredData.tables)) {
        if (!Array.isArray(rows) || rows.length === 0) {
          tableCounts[table] = 0;
          continue;
        }

        // Tạm xóa sạch bảng đích trước khi nạp lại
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        
        // Nạp từng dòng
        for (const row of rows) {
          const keys = Object.keys(row);
          const values = Object.values(row);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
          await client.query(
            `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
            values
          );
        }
        tableCounts[table] = rows.length;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else if (targetInMemory) {
    // Phục hồi vào target in-memory container
    if (restoredData.tables.organizations) {
      targetInMemory.inMemoryOrgs = [...restoredData.tables.organizations];
      tableCounts.organizations = targetInMemory.inMemoryOrgs.length;
    }
    if (restoredData.tables.users) {
      targetInMemory.users = new Map();
      for (const u of restoredData.tables.users) {
        targetInMemory.users.set(u.email, u);
      }
      tableCounts.users = targetInMemory.users.size;
    }
    if (restoredData.tables.products) {
      targetInMemory.inMemoryProducts = [...restoredData.tables.products];
      tableCounts.products = targetInMemory.inMemoryProducts.length;
    }
    if (restoredData.tables.farms) {
      targetInMemory.inMemoryFarms = [...restoredData.tables.farms];
      tableCounts.farms = targetInMemory.inMemoryFarms.length;
    }
    if (restoredData.tables.lots) {
      targetInMemory.inMemoryLots = [...restoredData.tables.lots];
      tableCounts.lots = targetInMemory.inMemoryLots.length;
    }
    if (restoredData.tables.batch_events) {
      targetInMemory.inMemoryBatchEvents = [...restoredData.tables.batch_events];
      tableCounts.batch_events = targetInMemory.inMemoryBatchEvents.length;
    }
    if (restoredData.tables.lot_transfers) {
      targetInMemory.inMemoryTransfers = [...restoredData.tables.lot_transfers];
      tableCounts.lot_transfers = targetInMemory.inMemoryTransfers.length;
    }
    if (restoredData.tables.lot_relations) {
      targetInMemory.inMemoryBatchRelations = [...restoredData.tables.lot_relations];
      tableCounts.lot_relations = targetInMemory.inMemoryBatchRelations.length;
    }
    if (restoredData.tables.shipments) {
      targetInMemory.inMemoryShipments = [...restoredData.tables.shipments];
      tableCounts.shipments = targetInMemory.inMemoryShipments.length;
    }
    if (restoredData.tables.shipment_lots) {
      targetInMemory.inMemoryShipmentLots = [...restoredData.tables.shipment_lots];
      tableCounts.shipment_lots = targetInMemory.inMemoryShipmentLots.length;
    }
    if (restoredData.tables.cold_boxes) {
      targetInMemory.inMemoryColdBoxes = [...restoredData.tables.cold_boxes];
      tableCounts.cold_boxes = targetInMemory.inMemoryColdBoxes.length;
    }
    if (restoredData.tables.temperature_readings) {
      targetInMemory.inMemoryReadings = [...restoredData.tables.temperature_readings];
      tableCounts.temperature_readings = targetInMemory.inMemoryReadings.length;
    }
    if (restoredData.tables.cold_chain_violations) {
      targetInMemory.inMemoryViolations = [...restoredData.tables.cold_chain_violations];
      tableCounts.cold_chain_violations = targetInMemory.inMemoryViolations.length;
    }
    if (restoredData.tables.recall_orders) {
      targetInMemory.inMemoryRecallOrders = [...restoredData.tables.recall_orders];
      tableCounts.recall_orders = targetInMemory.inMemoryRecallOrders.length;
    }
    if (restoredData.tables.recall_acknowledgments) {
      targetInMemory.inMemoryRecallAcknowledgments = [...restoredData.tables.recall_acknowledgments];
      tableCounts.recall_acknowledgments = targetInMemory.inMemoryRecallAcknowledgments.length;
    }
    if (restoredData.tables.audit_logs) {
      targetInMemory.inMemoryAuditLogs = [...restoredData.tables.audit_logs];
      tableCounts.audit_logs = targetInMemory.inMemoryAuditLogs.length;
    }
    if (restoredData.tables.temperature_hourly_aggregates) {
      targetInMemory.inMemoryAggregates = [...restoredData.tables.temperature_hourly_aggregates];
      tableCounts.temperature_hourly_aggregates = targetInMemory.inMemoryAggregates.length;
    }
  }

  // Xác nhận tính toàn vẹn chuỗi hash sau khôi phục (S-12)
  let integrityVerification = { checked: false, passed: true, details: [] };
  if (!skipVerification && restoredData.tables.lots && restoredData.tables.batch_events) {
    const lotIds = restoredData.tables.lots.map((l) => l.id || l.lot_id);
    const events = restoredData.tables.batch_events;
    const checks = [];

    for (const lotId of lotIds) {
      const lotEvents = events.filter((e) => (e.lot_id || e.batchId || e.lotId) === lotId);
      if (lotEvents.length > 0) {
        const verifyRes = verifyBatchEventChain(lotEvents);
        checks.push({ lotId, valid: verifyRes.valid, error: verifyRes.error || null });
      }
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
    console.error("Cách dùng: node restore_backup.js <duong-dan-tep-backup.enc>");
    process.exit(1);
  }

  restoreBackup(filePath)
    .then((res) => {
      console.log("[Restore S-57] Khôi phục thành công:");
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Restore S-57 Error]:", err);
      process.exit(1);
    });
}

module.exports = {
  restoreBackup,
  decryptData,
};
