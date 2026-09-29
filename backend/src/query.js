const SHARED_TABLES = new Set(["roles", "products", "schema_migrations"]);

/**
 * Shared scoped query helper that enforces organization tenant isolation.
 * Throws an explicit error if called without an organization context (unless table is explicitly global/shared).
 *
 * @param {import('pg').Pool|import('pg').Client} poolOrClient
 * @param {object} authContext - { organizationId, roleId, isInspector }
 * @param {string} tableName - Target table
 * @param {object} [options] - { where: string, params: any[], allowGlobal: boolean, orderBy: string }
 */
async function scopedQuery(poolOrClient, authContext, tableName, options = {}) {
  const isShared = SHARED_TABLES.has(tableName) || options.allowGlobal === true;
  const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));
  const orgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;

  if (!isShared && !isInspector && !orgId) {
    throw new Error(
      `Truy vấn bị từ chối: thiếu ngữ cảnh tổ chức (organization context required) cho bảng '${tableName}'. Không có quyền truy vấn dữ liệu toàn cục.`
    );
  }

  const conditions = [];
  const params = options.params ? [...options.params] : [];

  if (!isShared && !isInspector) {
    params.push(orgId);
    conditions.push(`organization_id = $${params.length}`);
  }

  if (options.where) {
    conditions.push(`(${options.where})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderByClause = options.orderBy ? `ORDER BY ${options.orderBy}` : "";
  const sql = `SELECT * FROM ${tableName} ${whereClause} ${orderByClause}`.trim();

  if (!poolOrClient) {
    return { rows: [], sql, params };
  }

  return await poolOrClient.query(sql, params);
}

module.exports = {
  scopedQuery,
  SHARED_TABLES,
};
