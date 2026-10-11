/**
 * Module ghi nhận nhật ký thao tác nghiệp vụ (Operational Audit Log Engine - Story S-31)
 * Độc lập hoàn toàn với chuỗi khối băm sự kiện lô hàng (batch_events) và log an ninh (security_logger).
 */

const inMemoryAuditLogs = [];
const MAX_IN_MEMORY_LOGS = 1000;

/**
 * Ghi nhận một thao tác nghiệp vụ vào nhật ký kiểm toán (S-31)
 */
async function recordAuditLog({
  pool = null,
  client = null,
  inMemoryLogs = inMemoryAuditLogs,
  actorUserId = null,
  actorEmail = null,
  organizationId = "system",
  action,
  resourceType,
  resourceId = null,
  ipAddress = "127.0.0.1",
  userAgent = null,
  details = {},
  throwOnError = process.env.STRICT_AUDIT === "true",
}) {
  const logEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    actorUserId,
    actorEmail,
    organizationId,
    action,
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    details: typeof details === "object" ? details : { raw: details },
    createdAt: new Date().toISOString(),
  };

  const shouldThrow = Boolean(throwOnError || client || process.env.STRICT_AUDIT === "true");

  // 1. Ghi vĩnh viễn vào PostgreSQL nếu có kết nối (hỗ trợ client trong transaction hoặc pool)
  const db = client || pool;
  if (db && typeof db.query === "function") {
    try {
      await db.query(
        `INSERT INTO audit_logs (
          actor_user_id, actor_email, organization_id, action, resource_type, resource_id, ip_address, user_agent, details, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          actorUserId,
          actorEmail,
          organizationId,
          action,
          resourceType,
          resourceId,
          ipAddress,
          userAgent,
          JSON.stringify(logEntry.details),
        ]
      );
    } catch (err) {
      console.error("[AUDIT LOG ERROR] Không thể ghi audit log vào CSDL:", err.message);
      if (shouldThrow) {
        throw new Error(`Audit log persistence failed: ${err.message}`);
      }
    }
  }

  // 2. Lưu vào RAM (In-Memory Buffer) sau khi ghi CSDL thành công
  if (Array.isArray(inMemoryLogs)) {
    inMemoryLogs.unshift(logEntry);
    if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
      inMemoryLogs.pop();
    }
  }

  return logEntry;
}

/**
 * Truy vấn nhật ký thao tác nghiệp vụ hỗ trợ bộ lọc và phân trang (S-31)
 */
async function getAuditLogs({
  pool = null,
  inMemoryLogs = inMemoryAuditLogs,
  organizationId = null,
  action = null,
  resourceType = null,
  resourceId = null,
  limit = 50,
  offset = 0,
}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (pool && typeof pool.query === "function") {
    try {
      const conditions = [];
      const values = [];

      if (organizationId) {
        values.push(organizationId);
        conditions.push(`organization_id = $${values.length}`);
      }
      if (action) {
        values.push(action);
        conditions.push(`action = $${values.length}`);
      }
      if (resourceType) {
        values.push(resourceType);
        conditions.push(`resource_type = $${values.length}`);
      }
      if (resourceId) {
        values.push(resourceId);
        conditions.push(`resource_id = $${values.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      
      const countRes = await pool.query(
        `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
        values
      );
      const total = Number(countRes.rows[0].total || 0);

      values.push(safeLimit);
      values.push(safeOffset);
      const queryStr = `
        SELECT id, actor_user_id, actor_email, organization_id, action, resource_type, resource_id, ip_address, user_agent, details, created_at
        FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      `;

      const logsRes = await pool.query(queryStr, values);
      return {
        total,
        limit: safeLimit,
        offset: safeOffset,
        logs: logsRes.rows.map((r) => ({
          id: r.id,
          actorUserId: r.actor_user_id,
          actorEmail: r.actor_email,
          organizationId: r.organization_id,
          action: r.action,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          ipAddress: r.ip_address,
          userAgent: r.user_agent,
          details: r.details,
          createdAt: r.created_at,
        })),
      };
    } catch (err) {
      console.warn("[AUDIT LOG QUERY ERROR] Lỗi truy vấn database, fallback sang in-memory:", err.message);
    }
  }

  // Fallback in-memory
  let filtered = [...inMemoryLogs];
  if (organizationId) filtered = filtered.filter((l) => l.organizationId === organizationId);
  if (action) filtered = filtered.filter((l) => l.action === action);
  if (resourceType) filtered = filtered.filter((l) => l.resourceType === resourceType);
  if (resourceId) filtered = filtered.filter((l) => l.resourceId === resourceId);

  const total = filtered.length;
  const paged = filtered.slice(safeOffset, safeOffset + safeLimit);

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    logs: paged,
  };
}

module.exports = {
  inMemoryAuditLogs,
  recordAuditLog,
  getAuditLogs,
};
