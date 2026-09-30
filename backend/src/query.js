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
  const isInspector = Boolean(
    authContext &&
      (authContext.roleId === "inspector" ||
        authContext.isInspector ||
        authContext.roleId === "admin" ||
        authContext.isAdmin)
  );
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

/**
 * Scoped query helper to fetch a single record by ID with strict tenant isolation at the query layer (T-12).
 * Automatically enforces:
 * - Standard tenant user: SELECT * FROM {table} WHERE id = $1 AND organization_id = $2
 * - Inspector / shared tables: SELECT * FROM {table} WHERE id = $1
 * Throws an error if called without organization context on tenant tables.
 *
 * @param {import('pg').Pool|import('pg').Client} poolOrClient
 * @param {object} authContext - { organizationId, roleId, isInspector }
 * @param {string} tableName - Target table
 * @param {string|number} id - Record ID
 * @param {object} [options] - { allowGlobal: boolean }
 */
async function scopedQueryById(poolOrClient, authContext, tableName, id, options = {}) {
  const isShared = SHARED_TABLES.has(tableName) || options.allowGlobal === true;
  const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));
  const orgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;

  if (!isShared && !isInspector && !orgId) {
    throw new Error(
      `Truy vấn bị từ chối: thiếu ngữ cảnh tổ chức (organization context required) cho bảng '${tableName}'. Không có quyền truy vấn dữ liệu toàn cục.`
    );
  }

  const params = [id];
  let sql;

  if (isShared || isInspector) {
    sql = `SELECT * FROM ${tableName} WHERE id = $1`;
  } else {
    params.push(orgId);
    sql = `SELECT * FROM ${tableName} WHERE id = $1 AND organization_id = $2`;
  }

  if (!poolOrClient) {
    return { rows: [], row: null, sql, params, isCrossTenant: false, targetOrgId: null };
  }

  const result = await poolOrClient.query(sql, params);
  const row = result.rows[0] || null;

  let isCrossTenant = false;
  let targetOrgId = null;
  // Khi không tìm thấy theo tenant của user hiện tại, probe xem id này có tồn tại ở tenant khác không
  if (!row && !isShared && !isInspector) {
    try {
      const probe = await poolOrClient.query(
        `SELECT organization_id FROM ${tableName} WHERE id = $1`,
        [id]
      );
      if (probe.rows.length > 0 && probe.rows[0].organization_id !== orgId) {
        isCrossTenant = true;
        targetOrgId = probe.rows[0].organization_id;
      }
    } catch {
      isCrossTenant = false;
    }
  }

  return {
    ...result,
    row,
    isCrossTenant,
    targetOrgId,
    sql,
    params,
  };
}

module.exports = {
  scopedQuery,
  scopedQueryById,
  SHARED_TABLES,
};
