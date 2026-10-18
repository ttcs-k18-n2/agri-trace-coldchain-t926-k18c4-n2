"use strict";

const crypto = require("node:crypto");
const { verifyBatchEventChain } = require("./integrity_verifier");
const { recordAuditLog } = require("./audit_logger");

const inMemoryIntegrityJobs = [];
const inMemoryIntegrityLogs = [];

/**
 * Job kiểm tra toàn vẹn định kỳ mọi lô hàng (Story S-55 / Jira N2-123)
 * - Quét theo từng nhóm lô nhỏ (batching) để chống khóa bảng sự kiện lâu
 * - Chạy kiểm tra mật mã học S-12 cho từng lô
 * - Ghi kết quả vào nhật ký audit và phát cảnh báo nếu đứt mạch hash
 */
async function runIntegrityAuditJob({
  pool,
  batchSize = 25,
  actorEmail = "system-cron@agri-trace.internal",
  inMemoryContext = {},
}) {
  const jobId = "JOB-INT-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const startedAt = new Date().toISOString();

  let lotsToScan = [];
  if (pool) {
    try {
      // Lấy danh sách các lô hàng cần kiểm tra
      const lotsRes = await pool.query(
        "SELECT id, name, organization_id FROM lots ORDER BY created_at DESC"
      );
      lotsToScan = lotsRes.rows;
    } catch (err) {
      console.error("[S-55 Job Error]: Không thể tải danh sách lô từ DB:", err.message);
      lotsToScan = [];
    }
  } else {
    const list = inMemoryContext.inMemoryLots || [];
    lotsToScan = list.map((l) => ({
      id: l.id || l.code || l.lot_id,
      name: l.name,
      organization_id: l.organizationId || l.organization_id,
    }));
  }

  const jobRecord = {
    id: jobId,
    started_at: startedAt,
    completed_at: null,
    total_lots_scanned: lotsToScan.length,
    compromised_lots_count: 0,
    status: "RUNNING",
    error_details: [],
    created_at: startedAt,
  };

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO integrity_audit_jobs (id, started_at, total_lots_scanned, status)
         VALUES ($1, $2, $3, $4)`,
        [jobId, startedAt, lotsToScan.length, "RUNNING"]
      );
    } catch {
      // fallback in-memory
    }
  }

  const jobLogs = [];
  const compromisedLots = [];

  // Quét theo từng mẻ nhỏ (Batching) để giải phóng tài nguyên
  for (let i = 0; i < lotsToScan.length; i += batchSize) {
    const batch = lotsToScan.slice(i, i + batchSize);

    for (const lot of batch) {
      const lotId = lot.id;
      let events = [];

      if (pool) {
        try {
          const evRes = await pool.query(
            `SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC`,
            [lotId]
          );
          events = evRes.rows;
        } catch {
          events = [];
        }
      } else {
        const eventsList = inMemoryContext.inMemoryBatchEvents || [];
        events = eventsList
          .filter((e) => (e.batchId || e.batch_id || e.lotId) === lotId)
          .sort((a, b) => Number(a.sequenceNo || a.sequence_no) - Number(b.sequenceNo || b.sequence_no));
      }

      // Xác minh tính toàn vẹn chuỗi Hash chuẩn S-12
      const verification = verifyBatchEventChain(events);
      const isOk = Boolean(verification.valid);

      const logEntry = {
        id: "LOG-" + crypto.randomUUID(),
        job_id: jobId,
        lot_id: lotId,
        is_valid: isOk,
        error_type: isOk ? null : verification.type || "BROKEN_CHAIN",
        error_message: isOk ? null : verification.error,
        first_invalid_sequence: isOk ? null : verification.firstInvalidSequence,
        final_hash: verification.finalHash || null,
        inspected_at: new Date().toISOString(),
      };

      jobLogs.push(logEntry);

      if (pool) {
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
          // ignore error
        }
      }

      // NẾU PHÁT HIỆN ĐỨT MẠCH HOẶC BỊ SỬA ĐỔI -> PHÁT CẢNH BÁO KHẨN CẤP ĐẾN QUẢN TRỊ VIÊN
      if (!isOk) {
        compromisedLots.push({
          lotId,
          errorType: verification.type,
          error: verification.error,
          firstInvalidSequence: verification.firstInvalidSequence,
        });

        // Ghi nhật ký kiểm toán cảnh báo xâm nhập toàn vẹn
        await recordAuditLog({
          pool,
          inMemoryLogs: inMemoryContext.inMemoryAuditLogs,
          actorUserId: "system-integrity-scanner",
          actorEmail: actorEmail,
          organizationId: lot.organization_id || "system",
          action: "INTEGRITY_BREACH_DETECTED",
          resourceType: "lot",
          resourceId: lotId,
          details: {
            jobId,
            lotId,
            errorType: verification.type,
            error: verification.error,
            firstInvalidSequence: verification.firstInvalidSequence,
            severity: "CRITICAL_ALERT",
          },
        });
      }
    }
  }

  const completedAt = new Date().toISOString();
  const finalStatus = compromisedLots.length > 0 ? "COMPROMISED" : "PASSED";

  jobRecord.completed_at = completedAt;
  jobRecord.compromised_lots_count = compromisedLots.length;
  jobRecord.status = finalStatus;
  jobRecord.error_details = compromisedLots;

  if (pool) {
    try {
      await pool.query(
        `UPDATE integrity_audit_jobs
         SET completed_at = $1, compromised_lots_count = $2, status = $3, error_details = $4
         WHERE id = $5`,
        [completedAt, compromisedLots.length, finalStatus, JSON.stringify(compromisedLots), jobId]
      );
    } catch {
      // ignore error
    }
  }

  inMemoryIntegrityJobs.unshift(jobRecord);
  inMemoryIntegrityLogs.push(...jobLogs);

  return {
    jobId,
    startedAt,
    completedAt,
    totalLotsScanned: lotsToScan.length,
    compromisedLotsCount: compromisedLots.length,
    status: finalStatus,
    compromisedLots,
    logs: jobLogs,
  };
}

/**
 * Lấy kết quả lần quét toàn vẹn gần nhất (dùng cho Dashboard Quản trị)
 */
async function getLatestIntegrityAudit({ pool, inMemoryContext = {} }) {
  if (pool) {
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
      // fallback
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
  runIntegrityAuditJob,
  getLatestIntegrityAudit,
  inMemoryIntegrityJobs,
  inMemoryIntegrityLogs,
};
