/**
 * Security & Audit Logger for AgriTrace ColdChain
 * Handles structured logging of authentication and authorization violations (such as cross-tenant access attempts).
 */

const recentSecurityLogs = [];
const MAX_LOGS_BUFFER = 200;

function logSecurityEvent(event, details = {}) {
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

  recentSecurityLogs.push(logEntry);
  if (recentSecurityLogs.length > MAX_LOGS_BUFFER) {
    recentSecurityLogs.shift();
  }

  // Structured console output
  console.warn(`[SECURITY AUDIT] ${JSON.stringify(logEntry)}`);

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
