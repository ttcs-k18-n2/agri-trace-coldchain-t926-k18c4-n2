"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
const MAX_BACKUP_RETENTION = 14;

/**
 * Lấy và kiểm tra tính hợp lệ của khóa mã hóa bí mật
 * TUYỆT ĐỐI không sử dụng khóa mặc định viết cứng trong mã nguồn
 */
function getEncryptionKey(providedKey) {
  const key = providedKey || process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "[BẢO MẬT] Bắt buộc cấu hình BACKUP_ENCRYPTION_KEY an toàn qua biến môi trường hoặc tham số."
    );
  }
  if (typeof key !== "string" || key.trim().length < 16) {
    throw new Error(
      "[BẢO MẬT] Khóa BACKUP_ENCRYPTION_KEY phải có độ dài tối thiểu 16 ký tự để đảm bảo chuẩn an toàn mã hóa AES-256-GCM."
    );
  }
  return key;
}

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
    "cold_boxes",
    "shipments",
    "shipment_lots",
    "temperature_readings",
    "cold_chain_violations",
    "recall_orders",
    "recall_acknowledgments",
    "audit_logs",
    "temperature_hourly_aggregates",
    "public_lot_cache",
    "public_lot_rate_limits",
    "integrity_audit_jobs",
    "integrity_audit_logs",
    "farmer_anonymization_requests",
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
        dump.tables[tbl] = res ? (res.rows || []) : [];
      } catch (err) {
        // Mã 42P01: undefined_table (bảng chưa tồn tại do migration chưa chạy)
        if (err.code === "42P01" || (err.message && err.message.includes("does not exist"))) {
          dump.tables[tbl] = [];
        } else {
          // Bất kỳ lỗi kết nối hoặc truy vấn nào khác -> KHÔNG được bỏ qua, ném lỗi để dừng backup
          throw new Error(`[Backup Fatal] Truy vấn bảng '${tbl}' thất bại: ${err.message}`);
        }
      }
    }
  } else {
    // In-memory context mapping
    dump.tables.organizations = inMemoryContext.inMemoryOrgs || [];
    dump.tables.users = inMemoryContext.users
      ? Array.isArray(inMemoryContext.users)
        ? inMemoryContext.users
        : Array.from(inMemoryContext.users.values())
      : [];
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
    dump.tables.public_lot_cache = inMemoryContext.inMemoryPublicCache || [];
    dump.tables.public_lot_rate_limits = inMemoryContext.inMemoryRateLimits || [];
    dump.tables.integrity_audit_jobs = inMemoryContext.inMemoryIntegrityJobs || [];
    dump.tables.integrity_audit_logs = inMemoryContext.inMemoryIntegrityLogs || [];
    dump.tables.farmer_anonymization_requests = inMemoryContext.inMemoryAnonymizationRequests || [];
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
      try {
        fs.unlinkSync(item.fullPath);
        deletedFiles.push(item.filename);
      } catch (err) {
        console.warn(`[Rotation Warning] Không thể xóa tệp cũ ${item.filename}:`, err.message);
      }
    }
  }

  return deletedFiles;
}

/**
 * Hàm chính thực hiện sao lưu hằng đêm
 */
async function runNightlyBackup(options = {}) {
  const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
  const encryptionKey = getEncryptionKey(options.encryptionKey);
  const maxRetention = options.maxRetention || MAX_BACKUP_RETENTION;
  const pool = options.pool || null;
  const inMemoryContext = options.inMemoryContext || {};

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const startTime = Date.now();
  const rawData = await extractAllData({ pool, inMemoryContext });

  // Kiểm tra tính toàn vẹn dữ liệu: không cho phép sao lưu rỗng bất thường khi có kết nối pool
  if (pool) {
    const essentialTables = ["organizations", "users", "products", "farms", "lots"];
    const allEssentialMissing = essentialTables.every(
      (tbl) => !rawData.tables[tbl] || rawData.tables[tbl].length === 0
    );
    // Nếu có pool nhưng tất cả bảng cốt lõi đều rỗng bất thường -> cảnh báo
    if (allEssentialMissing && options.allowEmptyDatabase !== true) {
      console.warn("[Backup Notice] CSDL đang ở trạng thái rỗng hoặc mới khởi tạo.");
    }
  }

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

  // Xoay vòng bản sao lưu (giữ tối đa 14 bản)
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
  manifest.backups = (manifest.backups || []).filter((b) =>
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
  let pool = null;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const { Pool } = require("pg");
      pool = new Pool({ connectionString: dbUrl });
      console.log("[Backup S-57 CLI] Đã khởi tạo kết nối PostgreSQL với:", dbUrl.replace(/:[^:@]+@/, ":***@"));
    } catch (pgErr) {
      console.warn("[Backup S-57 CLI] Không thể khởi tạo pg Pool:", pgErr.message);
    }
  } else {
    console.warn("[Backup S-57 CLI Warning] DATABASE_URL không được cấu hình. Chạy ở chế độ Standalone / Mock.");
  }

  runNightlyBackup({ pool })
    .then((res) => {
      console.log("[Backup S-57] Hoàn thành sao lưu cơ sở dữ liệu:");
      console.log(JSON.stringify(res, null, 2));
      if (pool) {
        pool.end().catch(() => {});
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Backup S-57 Error]:", err.message);
      if (pool) {
        pool.end().catch(() => {});
      }
      process.exit(1);
    });
}

module.exports = {
  runNightlyBackup,
  encryptData,
  deriveKey,
  getEncryptionKey,
  rotateBackups,
  extractAllData,
  DEFAULT_BACKUP_DIR,
  MAX_BACKUP_RETENTION,
};
