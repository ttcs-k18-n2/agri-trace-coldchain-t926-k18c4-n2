"use strict";

const crypto = require("node:crypto");
let cron = null;
try {
  cron = require("node-cron");
} catch {
  // node-cron optional fallback
}

const { verifyBatchEventChain, verifyBatchIntegrity } = require("./integrity_verifier");
const { recordAuditLog } = require("./audit_logger");

const DEFAULT_CRON_SCHEDULE = "0 2 * * *";
const DEFAULT_BATCH_SIZE = 100;

const inMemoryIntegrityJobs = [];
const inMemoryIntegrityLogs = [];

/**
 * Job kiểm tra toàn vẹn định kỳ mọi lô hàng (Story S-55 / Jira N2-123)
 * - Quét theo từng nhóm lô nhỏ (batching LIMIT/OFFSET) để chống khóa bảng sự kiện lâu
 * - Chạy kiểm tra mật mã học S-12 cho từng lô
 * - Ghi kết quả vào nhật ký audit và phát cảnh báo quản trị nếu đứt mạch hash
 * - Bảo vệ: Không bao giờ tự động sinh 250 lô giả trong chế độ production
 */
async function runIntegrityAuditJob(options = {}) {
  const {
    pool = null,
    batchSize = DEFAULT_BATCH_SIZE,
    delayBetweenBatchesMs = 0,
    actorEmail = "system-cron@agri-trace.internal",
    inMemoryContext = {},
    mockLots = null,
    verifier = null,
    allowDemoMock = false,
  } = options;

  const jobId = "JOB-INT-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const limit = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);

  const isDbQuery = Boolean(pool && typeof pool.query === "function");
  // Chỉ ghi vào bảng CSDL audit nếu là kết nối PostgreSQL thật (có method connect)
  const isDbAuditLogging = Boolean(pool && typeof pool.connect === "function" && options.skipAuditDb !== true);

  let sourceLots = [];

  if (Array.isArray(mockLots)) {
    sourceLots = mockLots.map((l) => (typeof l === "string" ? { id: l } : l));
  } else if (!isDbQuery) {
    if (inMemoryContext && Array.isArray(inMemoryContext.inMemoryLots) && inMemoryContext.inMemoryLots.length > 0) {
      sourceLots = inMemoryContext.inMemoryLots.map((l) => ({
        id: l.id || l.code || l.lot_id,
        name: l.name,
        organization_id: l.organizationId || l.organization_id,
      }));
    } else if (process.env.NODE_ENV === "production") {
      // BẢO MẬT: Tuyệt đối không sinh lô giả trong môi trường production!
      sourceLots = [];
    } else if (allowDemoMock) {
      sourceLots = Array.from({ length: 250 }, (_, i) => ({
        id: `MOCK-LOT-${String(i + 1).padStart(3, "0")}`,
      }));
    } else {
      sourceLots = [];
    }
  }

  const jobRecord = {
    id: jobId,
    started_at: startedAt,
    completed_at: null,
    total_lots_scanned: 0,
    compromised_lots_count: 0,
    status: "RUNNING",
    error_details: [],
    created_at: startedAt,
  };

  if (isDbAuditLogging) {
    try {
      await pool.query(
        `INSERT INTO integrity_audit_jobs (id, started_at, total_lots_scanned, status)
         VALUES ($1, $2, $3, $4)`,
        [jobId, startedAt, 0, "RUNNING"]
      );
    } catch {
      // Bỏ qua nếu bảng chưa migrate
    }
  }

  const jobLogs = [];
  const compromisedLots = [];
  let totalScanned = 0;
  let validCount = 0;
  let invalidCount = 0;
  let batchesCount = 0;
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      let currentBatch = [];

      if (isDbQuery) {
        try {
          const res = await pool.query(
            "SELECT id FROM lots ORDER BY id ASC LIMIT $1 OFFSET $2",
            [limit, offset]
          );
          currentBatch = res ? (res.rows || []) : [];
        } catch (dbErr) {
          console.error("[S-55 DB Error] Lỗi truy vấn batch lô:", dbErr.message);
          currentBatch = [];
        }
      } else {
        currentBatch = sourceLots.slice(offset, offset + limit);
      }

      if (!currentBatch || currentBatch.length === 0) {
        hasMore = false;
        break;
      }

      batchesCount++;

      for (const item of currentBatch) {
        const lotId = typeof item === "string" ? item : (item.id || item.code || item.lot_id);
        const lotOrgId = item.organization_id || item.organizationId || "system";

        try {
          let verification;
          if (typeof verifier === "function") {
            verification = await verifier(pool, lotId);
          } else if (isDbQuery) {
            try {
              verification = await verifyBatchIntegrity(pool, lotId);
            } catch (vErr) {
              verification = { valid: false, error: vErr.message, type: "VERIFICATION_ERROR" };
            }
          } else {
            const eventsList = inMemoryContext.inMemoryBatchEvents || [];
            const events = eventsList
              .filter((e) => (e.batchId || e.batch_id || e.lotId) === lotId)
              .sort(
                (a, b) =>
                  Number(a.sequenceNo !== undefined ? a.sequenceNo : a.sequence_no) -
                  Number(b.sequenceNo !== undefined ? b.sequenceNo : b.sequence_no)
              );
            verification = verifyBatchEventChain(events);
          }

          const isOk = Boolean(verification && verification.valid);

          if (isOk) {
            validCount++;
          } else {
            invalidCount++;
            const errType = (verification && verification.type) || "BROKEN_CHAIN";
            const errMsg = (verification && verification.error) || "Lỗi toàn vẹn không xác định";
            const firstInvalidSeq = (verification && verification.firstInvalidSequence) || null;

            compromisedLots.push({
              lotId,
              errorType: errType,
              error: errMsg,
              firstInvalidSequence: firstInvalidSeq,
              details: verification,
            });

            // Ghi nhật ký kiểm toán cảnh báo đứt mạch/xâm nhập toàn vẹn
            try {
              await recordAuditLog({
                pool: isDbAuditLogging ? pool : null,
                inMemoryLogs: inMemoryContext.inMemoryAuditLogs,
                actorUserId: "system-integrity-scanner",
                actorEmail,
                organizationId: lotOrgId,
                action: "INTEGRITY_BREACH_DETECTED",
                resourceType: "lot",
                resourceId: lotId,
                details: {
                  jobId,
                  lotId,
                  errorType: errType,
                  error: errMsg,
                  firstInvalidSequence: firstInvalidSeq,
                  severity: "CRITICAL_ALERT",
                },
              });
            } catch (auditErr) {
              console.warn("[S-55 Audit Warning]:", auditErr.message);
            }
          }

          const logEntry = {
            id: "LOG-" + crypto.randomUUID(),
            job_id: jobId,
            lot_id: lotId,
            is_valid: isOk,
            error_type: isOk ? null : (verification ? verification.type : "BROKEN_CHAIN"),
            error_message: isOk ? null : (verification ? verification.error : "Không rõ lỗi"),
            first_invalid_sequence: isOk ? null : (verification ? verification.firstInvalidSequence : null),
            final_hash: (verification && verification.finalHash) || null,
            inspected_at: new Date().toISOString(),
          };

          jobLogs.push(logEntry);

          if (isDbAuditLogging) {
            try {
              await pool.query(
                `INSERT INTO integrity_audit_logs (id, job_id, lot_id, is_valid, error_type, error_message, first_invalid_sequence, final_hash, inspected_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  logEntry.id,
                  logEntry.job_id,
                  logEntry.lot_id,
                  logEntry.is_valid,
                  logEntry.error_type,
                  logEntry.error_message,
                  logEntry.first_invalid_sequence,
                  logEntry.final_hash,
                  logEntry.inspected_at,
                ]
              );
            } catch {
              // ignore
            }
          }
        } catch (lotErr) {
          invalidCount++;
          compromisedLots.push({
            lotId,
            errorType: "EXCEPTION",
            error: lotErr.message,
          });
        }
        totalScanned++;
      }

      offset += currentBatch.length;
      if (currentBatch.length < limit) {
        hasMore = false;
      } else if (delayBetweenBatchesMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatchesMs));
      }
    }
  } catch (loopErr) {
    console.error("[S-55 Loop Error]:", loopErr.message);
  }

  const completedAt = new Date().toISOString();
  const finalStatus = invalidCount > 0 ? "COMPROMISED" : "PASSED";
  const durationMs = Date.now() - startTime;

  jobRecord.completed_at = completedAt;
  jobRecord.total_lots_scanned = totalScanned;
  jobRecord.compromised_lots_count = invalidCount;
  jobRecord.status = finalStatus;
  jobRecord.error_details = compromisedLots;

  if (isDbAuditLogging) {
    try {
      await pool.query(
        `UPDATE integrity_audit_jobs
         SET completed_at = $1, total_lots_scanned = $2, compromised_lots_count = $3, status = $4, error_details = $5
         WHERE id = $6`,
        [completedAt, totalScanned, invalidCount, finalStatus, JSON.stringify(compromisedLots), jobId]
      );
    } catch {
      // ignore
    }
  }

  inMemoryIntegrityJobs.unshift(jobRecord);
  inMemoryIntegrityLogs.push(...jobLogs);

  return {
    success: true,
    jobId,
    startedAt,
    completedAt,
    totalLotsScanned: totalScanned,
    totalScanned,
    validCount,
    invalidCount,
    compromisedLotsCount: invalidCount,
    batchesCount,
    status: finalStatus,
    compromisedLots,
    invalidLots: compromisedLots,
    logs: jobLogs,
    durationMs,
  };
}

/**
 * Hàm thực thi tác vụ quét kiểm tra toàn vẹn (tương thích cả 2 tên gọi)
 */
async function scanLotsInBatches(options = {}) {
  try {
    return await runIntegrityAuditJob(options);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      totalScanned: 0,
      validCount: 0,
      invalidCount: 0,
      batchesCount: 0,
      invalidLots: [],
      durationMs: 0,
    };
  }
}

const runIntegrityCheck = scanLotsInBatches;

/**
 * Khởi tạo và kích hoạt cron job kiểm tra tính toàn vẹn hàng ngày vào lúc 2:00 sáng.
 * Múi giờ Việt Nam: Asia/Ho_Chi_Minh
 */
function initIntegrityCheckJob({
  cronExpression = DEFAULT_CRON_SCHEDULE,
  pool = null,
  batchSize = DEFAULT_BATCH_SIZE,
  runOnInit = false,
  scheduled = true,
  ...scanOptions
} = {}) {
  let task = null;

  if (cron && typeof cron.schedule === "function") {
    task = cron.schedule(
      cronExpression,
      async () => {
        try {
          await runIntegrityAuditJob({ pool, batchSize, ...scanOptions });
        } catch (err) {
          console.error("[integrity-check-job] Lỗi thực thi cron:", err.message);
        }
      },
      {
        scheduled: scheduled !== false,
        timezone: "Asia/Ho_Chi_Minh",
      }
    );
  }

  if (runOnInit) {
    runIntegrityAuditJob({ pool, batchSize, ...scanOptions }).catch((err) => {
      console.error("[integrity-check-job] Lỗi khi chạy khởi động:", err.message);
    });
  }

  return (
    task || {
      start: () => {},
      stop: () => {},
      destroy: () => {},
    }
  );
}

const startIntegrityCheckJob = initIntegrityCheckJob;

/**
 * Lấy kết quả lần quét toàn vẹn gần nhất (dùng cho Dashboard Quản trị)
 */
async function getLatestIntegrityAudit({ pool = null, _inMemoryContext = {} } = {}) {
  if (pool && typeof pool.query === "function" && typeof pool.connect === "function") {
    try {
      const res = await pool.query(
        `SELECT * FROM integrity_audit_jobs ORDER BY started_at DESC LIMIT 1`
      );
      if (res.rows.length > 0) {
        const job = res.rows[0];
        const logsRes = await pool.query(
          `SELECT * FROM integrity_audit_logs WHERE job_id = $1 AND is_valid = FALSE`,
          [job.id]
        );
        return {
          job,
          compromisedLogs: logsRes.rows,
        };
      }
    } catch {
      // fallback in-memory
    }
  }

  const latestJob = inMemoryIntegrityJobs[0] || null;
  const compromisedLogs = latestJob
    ? inMemoryIntegrityLogs.filter((l) => l.job_id === latestJob.id && !l.is_valid)
    : [];

  return {
    job: latestJob,
    compromisedLogs,
  };
}

module.exports = {
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_BATCH_SIZE,
  runIntegrityAuditJob,
  scanLotsInBatches,
  runIntegrityCheck,
  initIntegrityCheckJob,
  startIntegrityCheckJob,
  getLatestIntegrityAudit,
  inMemoryIntegrityJobs,
  inMemoryIntegrityLogs,
};
