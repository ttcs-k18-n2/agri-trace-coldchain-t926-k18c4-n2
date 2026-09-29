/**
 * Tenant Repository Pattern for AgriTrace ColdChain (T-12)
 * Ensures all business data access strictly routes through tenant-isolated queries.
 */

const { scopedQuery, scopedQueryById, SHARED_TABLES } = require("./query");

class TenantRepository {
  constructor(tableName, options = {}) {
    this.tableName = tableName;
    this.isShared = SHARED_TABLES.has(tableName) || options.isShared === true;
  }

  /**
   * Find records scoped to tenant
   */
  async find(poolOrClient, authContext, options = {}) {
    return await scopedQuery(poolOrClient, authContext, this.tableName, options);
  }

  /**
   * Find single record by ID scoped to tenant
   */
  async findById(poolOrClient, authContext, id, options = {}) {
    return await scopedQueryById(poolOrClient, authContext, this.tableName, id, options);
  }

  /**
   * Insert record enforcing tenant ownership
   */
  async create(poolOrClient, authContext, data) {
    const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));
    if (isInspector) {
      throw new Error("Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, không có quyền ghi dữ liệu.");
    }
    const orgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;
    if (!this.isShared && !orgId) {
      throw new Error(`Tạo dữ liệu bị từ chối: thiếu ngữ cảnh tổ chức cho bảng '${this.tableName}'.`);
    }

    const recordData = {
      ...data,
      ...(this.isShared ? {} : { organization_id: orgId }),
    };

    const keys = Object.keys(recordData);
    const values = Object.values(recordData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`;

    if (!poolOrClient) {
      return { rows: [recordData], row: recordData, sql, values };
    }

    const result = await poolOrClient.query(sql, values);
    return { ...result, row: result.rows[0] || null };
  }

  /**
   * Update record scoped to tenant
   */
  async updateById(poolOrClient, authContext, id, data) {
    const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));
    if (isInspector) {
      throw new Error("Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, không có quyền sửa dữ liệu.");
    }
    const isAdmin = Boolean(authContext && (authContext.roleId === "admin" || authContext.isAdmin));
    const orgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;
    if (!this.isShared && !isAdmin && !orgId) {
      throw new Error(`Sửa dữ liệu bị từ chối: thiếu ngữ cảnh tổ chức cho bảng '${this.tableName}'.`);
    }

    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);

    let sql;
    const params = [...values, id];

    if (this.isShared || isAdmin) {
      sql = `UPDATE ${this.tableName} SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`;
    } else {
      params.push(orgId);
      sql = `UPDATE ${this.tableName} SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${params.length - 1} AND organization_id = $${params.length} RETURNING *`;
    }

    if (!poolOrClient) {
      return { rows: [], row: null, sql, params };
    }

    const result = await poolOrClient.query(sql, params);
    return { ...result, row: result.rows[0] || null };
  }
}

function createTenantRepository(tableName, options = {}) {
  return new TenantRepository(tableName, options);
}

module.exports = {
  TenantRepository,
  createTenantRepository,
};
