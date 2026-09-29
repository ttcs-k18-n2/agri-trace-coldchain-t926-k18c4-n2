const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const request = require("supertest");
const { app, hashPassword, clearSecurityLogs, getRecentSecurityLogs, setDatabasePool } = require("../src/server");
const { scopedQuery, scopedQueryById } = require("../src/query");
const { createTenantRepository } = require("../src/tenant_repository");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://agri_user:agri_password@localhost:5432/agri_trace";

let pool;
let isPostgresAvailable = false;

test.before(async () => {
  try {
    pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
    await pool.query("SELECT 1;");
    isPostgresAvailable = true;
    setDatabasePool(pool);

    // Clean any leftover test records first
    await pool.query("DELETE FROM farms WHERE id IN ('FARM-REAL-ALPHA', 'FARM-REAL-BETA');");
    await pool.query("DELETE FROM users WHERE email IN ('user_alpha@test.org', 'user_beta@test.org');");
    await pool.query("DELETE FROM organizations WHERE id IN ('org-alpha', 'org-beta');");

    // 1. Seed 2 distinct organizations
    await pool.query(`
      INSERT INTO organizations (id, name, type) VALUES
        ('org-alpha', 'Hợp tác xã Nông sản Hữu cơ Alpha', 'producer'),
        ('org-beta', 'Công ty Cổ phần Nông nghiệp Beta', 'cooperative')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 2. Seed 2 users for the organizations
    const passHash = await hashPassword("Password@123");
    await pool.query(`
      INSERT INTO users (id, email, password_hash, organization_id, role_id) VALUES
        ('usr-test-alpha', 'user_alpha@test.org', $1, 'org-alpha', 'producer'),
        ('usr-test-beta', 'user_beta@test.org', $1, 'org-beta', 'cooperative')
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;
    `, [passHash]);

    // 3. Seed 2 farms for the 2 organizations
    await pool.query(`
      INSERT INTO farms (id, name, area, coordinates, organization_id) VALUES
        ('FARM-REAL-ALPHA', 'Vườn chè Oolong Alpha', 4.50, '21.56, 105.67', 'org-alpha'),
        ('FARM-REAL-BETA', 'Cánh đồng dưa lưới Beta', 6.20, '21.23, 106.18', 'org-beta')
      ON CONFLICT (id) DO NOTHING;
    `);
  } catch (err) {
    console.warn("[Postgres Integration Test] PostgreSQL not available on", DATABASE_URL, err.message);
    isPostgresAvailable = false;
  }
});

test.after(async () => {
  if (isPostgresAvailable && pool) {
    try {
      await pool.query("DELETE FROM farms WHERE id IN ('FARM-REAL-ALPHA', 'FARM-REAL-BETA');");
      await pool.query("DELETE FROM users WHERE email IN ('user_alpha@test.org', 'user_beta@test.org');");
      await pool.query("DELETE FROM organizations WHERE id IN ('org-alpha', 'org-beta');");
    } finally {
      setDatabasePool(null);
      await pool.end();
    }
  }
});

test("Real PostgreSQL: scopedQueryById enforces tenant isolation at query layer", async (t) => {
  if (!isPostgresAvailable) {
    t.skip("PostgreSQL is not reachable, skipping real Postgres test");
    return;
  }

  const authAlpha = { organizationId: "org-alpha", roleId: "producer" };
  const authBeta = { organizationId: "org-beta", roleId: "cooperative" };
  const authInspector = { organizationId: "org-inspector", roleId: "inspector" };

  // 1. Alpha user querying Alpha farm -> 200 OK
  const alphaRes = await scopedQueryById(pool, authAlpha, "farms", "FARM-REAL-ALPHA");
  assert.ok(alphaRes.row, "Alpha user must find their own farm");
  assert.equal(alphaRes.row.id, "FARM-REAL-ALPHA");
  assert.equal(alphaRes.row.organization_id, "org-alpha");
  assert.equal(alphaRes.isCrossTenant, false);

  // 2. Alpha user querying Beta farm -> returns null row, isCrossTenant = true
  const crossRes = await scopedQueryById(pool, authAlpha, "farms", "FARM-REAL-BETA");
  assert.equal(crossRes.row, null, "Database must NOT return Beta farm row to Alpha user");
  assert.equal(crossRes.isCrossTenant, true, "Probe must detect cross-tenant access attempt");
  assert.equal(crossRes.targetOrgId, "org-beta");

  // 3. Beta user querying Alpha farm -> returns null row, isCrossTenant = true
  const crossRes2 = await scopedQueryById(pool, authBeta, "farms", "FARM-REAL-ALPHA");
  assert.equal(crossRes2.row, null);
  assert.equal(crossRes2.isCrossTenant, true);
  assert.equal(crossRes2.targetOrgId, "org-alpha");

  // 4. Non-existent farm -> returns null, isCrossTenant = false
  const notFound = await scopedQueryById(pool, authAlpha, "farms", "FARM-NON-EXISTENT");
  assert.equal(notFound.row, null);
  assert.equal(notFound.isCrossTenant, false);

  // 5. Inspector querying both -> finds both rows
  const inspAlpha = await scopedQueryById(pool, authInspector, "farms", "FARM-REAL-ALPHA");
  assert.ok(inspAlpha.row);
  assert.equal(inspAlpha.row.id, "FARM-REAL-ALPHA");

  const inspBeta = await scopedQueryById(pool, authInspector, "farms", "FARM-REAL-BETA");
  assert.ok(inspBeta.row);
  assert.equal(inspBeta.row.id, "FARM-REAL-BETA");
});

test("Real PostgreSQL: scopedQuery list query isolates tenant data completely", async (t) => {
  if (!isPostgresAvailable) {
    t.skip("PostgreSQL is not reachable, skipping real Postgres test");
    return;
  }

  const authAlpha = { organizationId: "org-alpha", roleId: "producer" };
  const authBeta = { organizationId: "org-beta", roleId: "cooperative" };

  const listAlpha = await scopedQuery(pool, authAlpha, "farms");
  const alphaFarmIds = listAlpha.rows.map((r) => r.id);
  assert.ok(alphaFarmIds.includes("FARM-REAL-ALPHA"), "Alpha list must include Alpha farm");
  assert.ok(!alphaFarmIds.includes("FARM-REAL-BETA"), "Alpha list must NEVER include Beta farm");

  const listBeta = await scopedQuery(pool, authBeta, "farms");
  const betaFarmIds = listBeta.rows.map((r) => r.id);
  assert.ok(betaFarmIds.includes("FARM-REAL-BETA"), "Beta list must include Beta farm");
  assert.ok(!betaFarmIds.includes("FARM-REAL-ALPHA"), "Beta list must NEVER include Alpha farm");
});

test("Real PostgreSQL: TenantRepository executes tenant-isolated queries and mutations", async (t) => {
  if (!isPostgresAvailable) {
    t.skip("PostgreSQL is not reachable, skipping real Postgres test");
    return;
  }

  const farmRepo = createTenantRepository("farms");
  const authAlpha = { organizationId: "org-alpha", roleId: "producer" };

  // Find own
  const own = await farmRepo.findById(pool, authAlpha, "FARM-REAL-ALPHA");
  assert.ok(own.row);
  assert.equal(own.row.name, "Vườn chè Oolong Alpha");

  // Find cross-tenant
  const cross = await farmRepo.findById(pool, authAlpha, "FARM-REAL-BETA");
  assert.equal(cross.row, null);
  assert.equal(cross.isCrossTenant, true);

  // Update own
  const updated = await farmRepo.updateById(pool, authAlpha, "FARM-REAL-ALPHA", {
    name: "Vườn chè Oolong Alpha (Đã cập nhật)",
  });
  assert.ok(updated.row);
  assert.equal(updated.row.name, "Vườn chè Oolong Alpha (Đã cập nhật)");

  // Cross-tenant update must affect 0 rows
  const crossUpdate = await farmRepo.updateById(pool, authAlpha, "FARM-REAL-BETA", {
    name: "Cố tình sửa thửa Beta",
  });
  assert.equal(crossUpdate.rows.length, 0, "Cross-tenant update must affect 0 rows");
});

test("Real PostgreSQL API: Cross-tenant HTTP request returns 403 and records security audit log", async (t) => {
  if (!isPostgresAvailable) {
    t.skip("PostgreSQL is not reachable, skipping real Postgres test");
    return;
  }

  clearSecurityLogs();

  const agentAlpha = request.agent(app);
  await agentAlpha
    .post("/api/login")
    .send({ email: "user_alpha@test.org", password: "Password@123" });

  // 1. Alpha reads own farm -> 200
  const ownRes = await agentAlpha.get("/api/farms/FARM-REAL-ALPHA");
  assert.equal(ownRes.status, 200);

  // 2. Alpha reads Beta farm -> 403 Forbidden
  const crossReadRes = await agentAlpha.get("/api/farms/FARM-REAL-BETA");
  assert.equal(crossReadRes.status, 403);
  assert.match(crossReadRes.body.message, /tổ chức khác/i);

  // 3. Verify security log was emitted for read violation
  const logsAfterRead = getRecentSecurityLogs();
  const readLog = logsAfterRead.find(
    (l) => l.event === "CROSS_TENANT_ACCESS_DENIED" && l.resourceId === "FARM-REAL-BETA"
  );
  assert.ok(readLog, "Must emit CROSS_TENANT_ACCESS_DENIED log");
  assert.equal(readLog.userEmail, "user_alpha@test.org");
  assert.equal(readLog.userOrgId, "org-alpha");
  assert.equal(readLog.targetOrgId, "org-beta");
  assert.equal(readLog.resourceType, "farms");

  // 4. Alpha attempts to update Beta farm -> 403 Forbidden
  const crossUpdateRes = await agentAlpha
    .put("/api/farms/FARM-REAL-BETA")
    .send({ name: "Alpha cướp thửa Beta", area: 10 });
  assert.equal(crossUpdateRes.status, 403);

  // 5. Verify security log was emitted for mutation violation
  const logsAfterUpdate = getRecentSecurityLogs();
  const updateLog = logsAfterUpdate.find(
    (l) => l.event === "CROSS_TENANT_MUTATION_DENIED" && l.resourceId === "FARM-REAL-BETA"
  );
  assert.ok(updateLog, "Must emit CROSS_TENANT_MUTATION_DENIED log");
  assert.equal(updateLog.userEmail, "user_alpha@test.org");
  assert.equal(updateLog.userOrgId, "org-alpha");
  assert.equal(updateLog.targetOrgId, "org-beta");
});
