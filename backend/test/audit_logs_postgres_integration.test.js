const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  setDatabasePool,
  recordAuditLog,
  getAuditLogs,
} = require("../src/server");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://agri_user:agri_password@localhost:5432/agri_trace";

let pool;
test("S-31: Kiểm thử tích hợp Audit Logs trên PostgreSQL thực tế", async (t) => {
  let isConnected = false;
  try {
    pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
    await pool.query("SELECT 1;");
    isConnected = true;
  } catch (err) {
    console.warn("[Audit Log PG Test] PostgreSQL không kết nối được trên " + DATABASE_URL + ":", err.message);
    isConnected = false;
  }

  if (!isConnected) {
    t.skip("Bỏ qua do PostgreSQL không khả dụng trên môi trường test cục bộ");
    return;
  }

  setDatabasePool(pool);

  const testOrgId = "org-audit-pg-test";
  const testUserId = "usr-audit-pg-test";
  const testUserEmail = "audit_pg_inspector@agri.vn";
  const testPassword = "Password123!";

  try {
    // 1. Dọn dẹp dữ liệu cũ nếu có
    await pool.query("DELETE FROM audit_logs WHERE organization_id = $1 OR actor_email = $2;", [testOrgId, testUserEmail]);
    await pool.query("DELETE FROM users WHERE id = $1 OR email = $2;", [testUserId, testUserEmail]);
    await pool.query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);

    // 2. Tạo tổ chức và người dùng Inspector để truy vấn audit logs
    await pool.query(
      "INSERT INTO organizations (id, name, type) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING;",
      [testOrgId, "Tổ chức Kiểm toán Test", "cooperative"]
    );

    const passHash = await hashPassword(testPassword);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, organization_id, role_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING;",
      [testUserId, testUserEmail, passHash, testOrgId, "inspector"]
    );

    users.set(testUserEmail, {
      id: testUserId,
      email: testUserEmail,
      passwordHash: passHash,
      failedCount: 0,
      lockedUntil: null,
      roleId: "inspector",
      organizationId: testOrgId,
    });

    const agent = request.agent(app);
    const loginRes = await agent.post("/api/login").send({ email: testUserEmail, password: testPassword });
    assert.equal(loginRes.status, 200, "Đăng nhập Inspector thành công");

    // Test 1: Ghi audit log qua pool và xác nhận lưu trực tiếp vào PostgreSQL
    await t.test("1. recordAuditLog ghi vĩnh viễn vào PostgreSQL và gán id từ RETURNING id", async () => {
      const createdLog = await recordAuditLog({
        pool,
        actorUserId: testUserId,
        actorEmail: testUserEmail,
        organizationId: testOrgId,
        action: "TEST_PG_DIRECT_INSERT",
        resourceType: "auth",
        resourceId: "AUTH-001",
        ipAddress: "127.0.0.1",
        userAgent: "IntegrationTest/1.0",
        details: { mode: "direct_pg" },
        throwOnError: true,
      });

      assert.ok(createdLog, "Phải trả về logEntry hợp lệ");
      assert.ok(createdLog.id, "Phải có id từ PostgreSQL");

      const checkDb = await pool.query("SELECT * FROM audit_logs WHERE id = $1;", [createdLog.id]);
      assert.equal(checkDb.rowCount, 1, "Bản ghi phải có trong bảng audit_logs PostgreSQL");
      assert.equal(checkDb.rows[0].action, "TEST_PG_DIRECT_INSERT");
      assert.equal(checkDb.rows[0].resource_type, "auth");
    });

    // Test 2: Tính nguyên tử - Rollback khi giao dịch thất bại
    await t.test("2. Tính nguyên tử - Khi transaction client bị rollback thì audit log không được ghi vào DB", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await recordAuditLog({
          client,
          actorUserId: testUserId,
          actorEmail: testUserEmail,
          organizationId: testOrgId,
          action: "TEST_TRANSACTION_ROLLBACK",
          resourceType: "lot",
          resourceId: "LOT-RB-01",
          details: { willRollback: true },
        });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      const checkDb = await pool.query(
        "SELECT * FROM audit_logs WHERE organization_id = $1 AND action = $2;",
        [testOrgId, "TEST_TRANSACTION_ROLLBACK"]
      );
      assert.equal(checkDb.rowCount, 0, "Bản ghi trong transaction bị ROLLBACK không được lưu vào PostgreSQL");
    });

    // Test 3: Truy vấn getAuditLogs lọc theo resourceType = "auth"
    await t.test("3. getAuditLogs trên PostgreSQL lọc chính xác theo resourceType='auth'", async () => {
      const result = await getAuditLogs({
        pool,
        organizationId: testOrgId,
        resourceType: "auth",
      });

      assert.ok(result.total >= 1, "Phải tìm thấy ít nhất 1 log loại auth");
      assert.ok(result.logs.every((l) => l.resourceType === "auth"));
    });

    // Test 4: Truy vấn getAuditLogs hỗ trợ phân trang limit và offset trên PostgreSQL
    await t.test("4. getAuditLogs trên PostgreSQL phân trang limit & offset chính xác", async () => {
      // Ghi thêm vài log để test phân trang
      for (let i = 1; i <= 3; i++) {
        await recordAuditLog({
          pool,
          actorUserId: testUserId,
          actorEmail: testUserEmail,
          organizationId: testOrgId,
          action: "TEST_PAGINATION",
          resourceType: "lot",
          resourceId: "LOT-PAGE-" + i,
          details: { index: i },
        });
      }

      const page1 = await getAuditLogs({
        pool,
        organizationId: testOrgId,
        action: "TEST_PAGINATION",
        limit: 2,
        offset: 0,
      });

      assert.equal(page1.limit, 2);
      assert.equal(page1.offset, 0);
      assert.equal(page1.logs.length, 2);
      assert.ok(page1.total >= 3);

      const page2 = await getAuditLogs({
        pool,
        organizationId: testOrgId,
        action: "TEST_PAGINATION",
        limit: 2,
        offset: 2,
      });

      assert.equal(page2.limit, 2);
      assert.equal(page2.offset, 2);
      assert.equal(page2.logs.length, 1);
    });

    // Test 5: getAuditLogs ném lỗi rõ ràng khi truy vấn PostgreSQL gặp sự cố (không âm thầm trả về RAM)
    await t.test("5. getAuditLogs ném lỗi rõ ràng khi query PostgreSQL lỗi thay vì fallback sang RAM", async () => {
      const brokenPool = {
        query: async () => {
          throw new Error("Simulated Connection Timeout on audit_logs table");
        },
      };

      await assert.rejects(
        async () => {
          await getAuditLogs({
            pool: brokenPool,
            organizationId: testOrgId,
          });
        },
        (err) => {
          assert.match(err.message, /Audit log query failed/);
          return true;
        },
        "Phải ném lỗi rõ ràng khi PostgreSQL query lỗi"
      );
    });

    // Test 6: Kiểm tra API HTTP GET /api/audit-logs qua Supertest
    await t.test("6. HTTP API GET /api/audit-logs hoạt động hoàn hảo trên PostgreSQL với bộ lọc và tìm kiếm", async () => {
      const res = await agent.get("/api/audit-logs?resourceType=auth&search=AUTH-001");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.logs));
      assert.ok(res.body.logs.length >= 1);
      assert.equal(res.body.logs[0].resourceId, "AUTH-001");
      assert.equal(res.body.logs[0].resourceType, "auth");
    });
  } finally {
    // Dọn dẹp dữ liệu kiểm thử
    if (pool) {
      await pool.query("DELETE FROM audit_logs WHERE organization_id = $1 OR actor_email = $2;", [testOrgId, testUserEmail]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1 OR email = $2;", [testUserId, testUserEmail]).catch(() => {});
      await pool.query("DELETE FROM organizations WHERE id = $1;", [testOrgId]).catch(() => {});
      setDatabasePool(null);
      await pool.end().catch(() => {});
    }
  }
});
