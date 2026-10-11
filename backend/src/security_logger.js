/**
 * Security & Audit Logger for AgriTrace ColdChain
 * Handles structured logging of authentication and authorization violations (such as cross-tenant access attempts).
 */

// Import file cấu hình kết nối database của dự án (hãy điều chỉnh lại đường dẫn nếu file db.js nằm ở thư mục khác)
const pool = require('./query');

const recentSecurityLogs = [];
const MAX_LOGS_BUFFER = 200;

async function logSecurityEvent(event, details = {}) {
  // 1. Định dạng dữ liệu log
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: "WARN",
    category: "SECURITY_AUDIT",
    event,
    userId: details.userId || "anonymous",
    userEmail: details.userEmail || null,
    userOrgId: details.userOrgId || null,
    userRole: details.userRole || null,
    resourceType: details.resourceType || null,
    resourceId: details.resourceId || null,
    targetOrgId: details.targetOrgId || null,
    action: details.action || "ACCESS",
    ip: details.ip || null,
    userAgent: details.userAgent || null,
    message:
      details.message ||
      `Phát hiện và chặn truy cập chéo tổ chức: người dùng ${details.userEmail || details.userId} (tổ chức ${details.userOrgId}) cố truy cập tài nguyên '${details.resourceType}:${details.resourceId}' thuộc tổ chức '${details.targetOrgId}'.`,
  };

  // 2. Lưu vào RAM để truy xuất nhanh (như code cũ của bạn)
  recentSecurityLogs.push(logEntry);
  if (recentSecurityLogs.length > MAX_LOGS_BUFFER) {
    recentSecurityLogs.shift();
  }

  // 3. In ra console
  console.warn(`[SECURITY AUDIT] ${JSON.stringify(logEntry)}`);

  // 4. Lưu vĩnh viễn vào Database (Task S-31)
  try {
    const query = `
      INSERT INTO audit_logs (actor_id, org_id, action, ip_address, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at;
    `;

    const values = [
      logEntry.userId === "anonymous" ? null : logEntry.userId, // actor_id
      logEntry.userOrgId,                                       // org_id
      logEntry.event,                                           // action
      logEntry.ip,                                              // ip_address
      logEntry                                                  // Toàn bộ metadata được lưu dưới dạng JSON trong cột details
    ];

    if (pool && pool.query) {
      await pool.query(query, values);
    }
  } catch (error) {
    console.error("[SECURITY AUDIT] Lỗi: Không thể lưu audit log vào database:", error);
  }

  return logEntry;
}

function getRecentSecurityLogs() {
  return [...recentSecurityLogs];
}

function clearSecurityLogs() {
  recentSecurityLogs.length = 0;
}

module.exports = {
  logSecurityEvent,
  getRecentSecurityLogs,
  clearSecurityLogs,
};