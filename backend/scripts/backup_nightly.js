"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
const MAX_BACKUP_RETENTION = 14;
const DEFAULT_KEY_SECRET = process.env.BACKUP_ENCRYPTION_KEY || "agri-trace-coldchain-backup-master-key-2026!";

/**
 * Tạo khóa mã hóa 256-bit từ khóa bí mật
 */
function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Mã hóa payload bằng thuật toán chuẩn AES-256-GCM
 */
function encryptData(plaintextString, keyBuffer) {
  const iv = crypto.randomBytes(12); // 96-bit IV chuẩn cho AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintextString, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 128-bit auth tag

  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("base64"),
    algorithm: "aes-256-gcm",
  };
}

/**
 * Lấy dữ liệu toàn bộ bảng từ database hoặc in-memory
 */
async function extractAllData({ pool, inMemoryContext = {} }) {
  const tables = [
    "organizations",
    "users",
    "products",
    "farms",
    "lots",
    "batch_events",
    "lot_transfers",
    "lot_relations",
    "shipments",
    "shipment_lots",
    "cold_boxes",
    "temperature_readings",
    "cold_chain_violations",
    "recall_orders",
    "recall_acknowledgments",
    "audit_logs",
    "temperature_hourly_aggregates",
  ];

  const dump = {
    metadata: {
      version: "1.0.0",
      extractedAt: new Date().toISOString(),
      source: pool ? "PostgreSQL" : "InMemory",
    },
    tables: {},
  };

  if (pool) {
    for (const tbl of tables) {
      try {
        const res = await pool.query(`SELECT * FROM ${tbl}`);
        dump.tables[tbl] = res.rows;
      } catch {
        dump.tables[tbl] = [];
      }
    }
  } else {
    // In-memory context mapping
    dump.tables.organizations = inMemoryContext.inMemoryOrgs || [];
    dump.tables.users = inMemoryContext.users ? Array.from(inMemoryContext.users.values()) : [];
    dump.tables.products = inMemoryContext.inMemoryProducts || [];
    dump.tables.farms = inMemoryContext.inMemoryFarms || [];
    dump.tables.lots = inMemoryContext.inMemoryLots || [];
    dump.tables.batch_events = inMemoryContext.inMemoryBatchEvents || [];
    dump.tables.lot_transfers = inMemoryContext.inMemoryTransfers || [];
    dump.tables.lot_relations = inMemoryContext.inMemoryBatchRelations || [];
    dump.tables.shipments = inMemoryContext.inMemoryShipments || [];
    dump.tables.shipment_lots = inMemoryContext.inMemoryShipmentLots || [];
    dump.tables.cold_boxes = inMemoryContext.inMemoryColdBoxes || [];
    dump.tables.temperature_readings = inMemoryContext.inMemoryReadings || [];
    dump.tables.cold_chain_violations = inMemoryContext.inMemoryViolations || [];
    dump.tables.recall_orders = inMemoryContext.inMemoryRecallOrders || [];
    dump.tables.recall_acknowledgments = inMemoryContext.inMemoryRecallAcknowledgments || [];
    dump.tables.audit_logs = inMemoryContext.inMemoryAuditLogs || [];
    dump.tables.temperature_hourly_aggregates = inMemoryContext.inMemoryAggregates || [];
  }

  return dump;
}

/**
 * Thực hiện xoay vòng bản sao lưu: Giữ tối đa 14 bản gần nhất, xóa các bản cũ hơn
 */
function rotateBackups(backupDir, maxRetention = MAX_BACKUP_RETENTION) {
  if (!fs.existsSync(backupDir)) return [];

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("backup-coldchain-") && f.endsWith(".enc"))
    .map((filename) => {
      const fullPath = path.join(backupDir, filename);
      const stat = fs.statSync(fullPath);
      return { filename, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs); // Mới nhất lên đầu

  const deletedFiles = [];
  if (files.length > maxRetention) {
    const toDelete = files.slice(maxRetention);
    for (const item of toDelete) {
      fs.unlinkSync(item.fullPath);
      deletedFiles.push(item.filename);
    }
  }

  return deletedFiles;
}

/**
 * Hàm chính thực hiện sao lưu hằng đêm
 */
async function runNightlyBackup(options = {}) {
  const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
  const encryptionKey = options.encryptionKey || DEFAULT_KEY_SECRET;
  const maxRetention = options.maxRetention || MAX_BACKUP_RETENTION;
  const pool = options.pool || null;
  const inMemoryContext = options.inMemoryContext || {};

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const startTime = Date.now();
  const rawData = await extractAllData({ pool, inMemoryContext });
  const plaintext = JSON.stringify(rawData);

  // Tính SHA-256 checksum của dữ liệu gốc
  const plaintextSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");

  // Mã hóa AES-256-GCM
  const keyBuffer = deriveKey(encryptionKey);
  const encryptedPayload = encryptData(plaintext, keyBuffer);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-coldchain-${timestamp}.enc`;
  const filePath = path.join(backupDir, filename);

  const fileEnvelope = {
    metadata: {
      filename,
      createdAt: new Date().toISOString(),
      algorithm: encryptedPayload.algorithm,
      iv: encryptedPayload.iv,
      authTag: encryptedPayload.authTag,
      plaintextSha256,
      tableSummary: Object.fromEntries(
        Object.entries(rawData.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
      ),
    },
    ciphertext: encryptedPayload.ciphertext,
  };

  const fileContent = JSON.stringify(fileEnvelope, null, 2);
  fs.writeFileSync(filePath, fileContent, "utf8");

  // Checksum của tệp mã hóa sau ghi
  const ciphertextSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");
  const fileSize = fs.statSync(filePath).size;

  // Xoay vòng bản sao lưu (giữ 14 bản)
  const prunedFiles = rotateBackups(backupDir, maxRetention);

  // Cập nhật manifest
  const manifestPath = path.join(backupDir, "backup-manifest.json");
  let manifest = { lastUpdated: new Date().toISOString(), backups: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = { lastUpdated: new Date().toISOString(), backups: [] };
    }
  }

  // Lọc lại manifest chỉ giữ các tệp còn tồn tại trên đĩa
  manifest.backups = manifest.backups.filter((b) =>
    fs.existsSync(path.join(backupDir, b.filename))
  );

  manifest.backups.unshift({
    filename,
    createdAt: fileEnvelope.metadata.createdAt,
    sizeBytes: fileSize,
    plaintextSha256,
    ciphertextSha256,
    algorithm: fileEnvelope.metadata.algorithm,
    tableSummary: fileEnvelope.metadata.tableSummary,
    status: "SUCCESS",
  });

  manifest.lastUpdated = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const elapsedMs = Date.now() - startTime;

  return {
    success: true,
    filename,
    filePath,
    fileSize,
    plaintextSha256,
    ciphertextSha256,
    prunedFiles,
    totalRemainingBackups: manifest.backups.length,
    elapsedMs,
  };
}

if (require.main === module) {
  runNightlyBackup()
    .then((res) => {
      console.log("[Backup S-57] Hoàn thành sao lưu cơ sở dữ liệu:");
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Backup S-57 Error]:", err);
      process.exit(1);
    });
}

module.exports = {
  runNightlyBackup,
  encryptData,
  deriveKey,
  rotateBackups,
  DEFAULT_BACKUP_DIR,
  MAX_BACKUP_RETENTION,
};
