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

    const adminUserId = "usr-audit-pg-admin";
    const adminUserEmail = "admin_audit_pg@agri.vn";
    await pool.query("DELETE FROM users WHERE id = $1 OR email = $2;", [adminUserId, adminUserEmail]);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, organization_id, role_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING;",
      [adminUserId, adminUserEmail, passHash, testOrgId, "admin"]
    );
    users.set(adminUserEmail, {
      id: adminUserId,
      email: adminUserEmail,
      passwordHash: passHash,
      failedCount: 0,
      lockedUntil: null,
      roleId: "admin",
      organizationId: testOrgId,
    });
    const adminAgent = request.agent(app);
    const adminLoginRes = await adminAgent.post("/api/login").send({ email: adminUserEmail, password: testPassword });
    assert.equal(adminLoginRes.status, 200, "Đăng nhập Admin thành công");

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

    // Test 7: Thao tác bắt buộc (MANDATORY_AUDIT_ACTIONS) ném lỗi khi ghi PostgreSQL thất bại dù ngoài transaction
    await t.test("7. Thao tác bắt buộc (MANDATORY_AUDIT_ACTIONS) ném lỗi khi ghi PostgreSQL thất bại", async () => {
      const brokenPool = {
        query: async () => {
          throw new Error("Simulated Disk Full on audit_logs table");
        },
      };

      // Hành vi LOCATION_CREATED là bắt buộc, phải throw
      await assert.rejects(
        async () => {
          await recordAuditLog({
            pool: brokenPool,
            action: "LOCATION_CREATED",
            resourceType: "location",
            resourceId: "LOC-FAIL-TEST",
          });
        },
        (err) => {
          assert.match(err.message, /Audit log persistence failed/);
          return true;
        },
        "Hành vi mandatory audit phải ném lỗi khi DB ghi thất bại"
      );

      // Hành vi không bắt buộc và throwOnError: false sẽ log error và trả về null
      const optionalLog = await recordAuditLog({
        pool: brokenPool,
        action: "OPTIONAL_ACTION_TEST",
        resourceType: "system",
        throwOnError: false,
      });
      assert.equal(optionalLog, null, "Hành vi không bắt buộc khi ghi DB lỗi trả về null");
    });

    // Test 8: Kiểm thử API /api/transfers/count, /api/transfers/summary và /api/transfers trên PostgreSQL thực tế
    await t.test("8. Kiểm thử API /api/transfers/count, /api/transfers/summary và /api/transfers trên PostgreSQL thực tế", async () => {
      const testLotId = "LOT-PG-TR-01";
      const testTransferId = "TR-PG-TEST-01";
      const otherOrgId = "org-audit-pg-other";

      await pool.query("INSERT INTO organizations (id, name, type) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING;", [otherOrgId, "Tổ chức Đối tác PG", "distributor"]);
      await pool.query("INSERT INTO products (id, name, unit) VALUES ('PROD-PG-TEST', 'SP Test PG', 'kg') ON CONFLICT (id) DO NOTHING;");
      await pool.query("DELETE FROM lot_transfers WHERE id = $1;", [testTransferId]);
      await pool.query("DELETE FROM lots WHERE id = $1;", [testLotId]);
      await pool.query(
        "INSERT INTO lots (id, name, product_id, organization_id, initial_quantity, remaining_quantity, status) VALUES ($1, $2, $3, $4, 100, 100, 'Đang lưu kho');",
        [testLotId, "Lô Test Transfers PG", "PROD-PG-TEST", testOrgId]
      );
      await pool.query(
        "INSERT INTO lot_transfers (id, lot_id, from_organization_id, to_organization_id, status, notes, created_by_user_id) VALUES ($1, $2, $3, $4, 'PENDING', 'Ghi chú test', $5);",
        [testTransferId, testLotId, testOrgId, otherOrgId, testUserId]
      );

      // 8.1 Kiểm tra GET /api/transfers/summary trên PostgreSQL
      const summaryRes = await agent.get("/api/transfers/summary");
      assert.equal(summaryRes.status, 200, "summary API phải trả về HTTP 200");
      assert.ok(summaryRes.body.outgoingPending >= 1, "outgoingPending phải >= 1");
      assert.ok(typeof summaryRes.body.incomingPending === "number");

      // 8.2 Kiểm tra GET /api/transfers/count trên PostgreSQL với đầy đủ các bộ lọc (P1 SQL placeholder fix)
      const countOutgoing = await agent.get("/api/transfers/count?type=outgoing&status=PENDING");
      assert.equal(countOutgoing.status, 200, "count outgoing phải trả về HTTP 200");
      assert.ok(countOutgoing.body.count >= 1, "count outgoing phải >= 1");

      const countIncoming = await agent.get("/api/transfers/count?type=incoming&status=PENDING");
      assert.equal(countIncoming.status, 200, "count incoming phải trả về HTTP 200");
      assert.ok(typeof countIncoming.body.count === "number");

      const countByLot = await agent.get("/api/transfers/count?lotId=" + testLotId);
      assert.equal(countByLot.status, 200, "count by lotId phải trả về HTTP 200");
      assert.equal(countByLot.body.count, 1, "count by lotId phải chính xác là 1");

      // 8.3 Kiểm tra GET /api/transfers có phân trang limit & offset trên PostgreSQL
      const pagedTransfers = await agent.get("/api/transfers?type=outgoing&status=PENDING&limit=1&offset=0");
      assert.equal(pagedTransfers.status, 200, "transfers paged API phải trả về HTTP 200");
      assert.equal(pagedTransfers.body.transfers.length, 1);
      assert.equal(pagedTransfers.body.limit, 1);
      assert.equal(pagedTransfers.body.offset, 0);
      assert.ok(pagedTransfers.body.total >= 1);

      // Dọn dẹp dữ liệu transfer test
      await pool.query("DELETE FROM lot_transfers WHERE id = $1;", [testTransferId]);
      await pool.query("DELETE FROM lots WHERE id = $1;", [testLotId]);
      await pool.query("DELETE FROM organizations WHERE id = $1;", [otherOrgId]);
    });

    // Test 9: Kiểm thử nhập CSV sản phẩm và thửa đất ghi nhận Audit Log trên PostgreSQL
    await t.test("9. Nhập CSV sản phẩm và thửa đất ghi nhận Audit Log (PRODUCTS_CSV_IMPORTED & FARMS_CSV_IMPORTED) trên PostgreSQL", async () => {
      const prodCsv = "name,unit\nSP Test PG CSV 1,kg\nSP Test PG CSV 2,tan";
      const prodImportRes = await adminAgent.post("/api/products/import-csv").send({ csvContent: prodCsv });
      assert.equal(prodImportRes.status, 201, "Nhập sản phẩm CSV thành công");

      // Kiểm tra trong PostgreSQL audit_logs có bản ghi PRODUCTS_CSV_IMPORTED
      const prodAudit = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'PRODUCTS_CSV_IMPORTED' AND organization_id = $1 ORDER BY created_at DESC LIMIT 1;",
        [testOrgId]
      );
      assert.equal(prodAudit.rows.length, 1, "Phải ghi nhận 1 bản ghi PRODUCTS_CSV_IMPORTED trong CSDL");
      assert.equal(prodAudit.rows[0].resource_type, "products");

      const farmCsv = "name,area,coordinates\nThửa Test PG CSV 1,1.5,\nThửa Test PG CSV 2,3.0,21.5 105.8";
      const farmImportRes = await adminAgent.post("/api/farms/import-csv").send({ csvContent: farmCsv });
      assert.equal(farmImportRes.status, 201, "Nhập thửa đất CSV thành công");

      // Kiểm tra trong PostgreSQL audit_logs có bản ghi FARMS_CSV_IMPORTED
      const farmAudit = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'FARMS_CSV_IMPORTED' AND organization_id = $1 ORDER BY created_at DESC LIMIT 1;",
        [testOrgId]
      );
      assert.equal(farmAudit.rows.length, 1, "Phải ghi nhận 1 bản ghi FARMS_CSV_IMPORTED trong CSDL");
      assert.equal(farmAudit.rows[0].resource_type, "farms");

      // Dọn dẹp sản phẩm và thửa đất vừa tạo
      await pool.query("DELETE FROM products WHERE name IN ('SP Test PG CSV 1', 'SP Test PG CSV 2');");
      await pool.query("DELETE FROM farms WHERE name IN ('Thửa Test PG CSV 1', 'Thửa Test PG CSV 2');");
    });

    // Test 10: Kiểm thử tính nguyên tử khi tạo địa điểm (POST /api/locations) và ghi audit log trên PostgreSQL
    await t.test("10. Tạo địa điểm và ghi audit log LOCATION_CREATED nguyên tử trên PostgreSQL", async () => {
      const locPayload = {
        name: "Kho Lạnh Test PG Atomicity",
        address: "123 Đường Test PG",
        locationType: "cold_storage",
      };

      const locRes = await adminAgent.post("/api/locations").send(locPayload);
      assert.equal(locRes.status, 201, "Tạo địa điểm thành công");
      const createdLocId = locRes.body.location.id;

      // Kiểm tra địa điểm và audit log trong CSDL
      const locDb = await pool.query("SELECT * FROM locations WHERE id = $1;", [createdLocId]);
      assert.equal(locDb.rows.length, 1, "Địa điểm phải tồn tại trong CSDL");

      const auditDb = await pool.query("SELECT * FROM audit_logs WHERE resource_id = $1 AND action = 'LOCATION_CREATED';", [createdLocId]);
      assert.equal(auditDb.rows.length, 1, "Audit log LOCATION_CREATED phải được lưu vào CSDL");

      // Dọn dẹp
      await pool.query("DELETE FROM locations WHERE id = $1;", [createdLocId]);
      await pool.query("DELETE FROM audit_logs WHERE resource_id = $1;", [createdLocId]);
    });
  } finally {
    // Dọn dẹp dữ liệu kiểm thử
    if (pool) {
      await pool.query("DELETE FROM audit_logs WHERE organization_id = $1 OR actor_email = $2;", [testOrgId, testUserEmail]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id IN ($1, $2) OR email IN ($3, $4);", [testUserId, "usr-audit-pg-admin", testUserEmail, "admin_audit_pg@agri.vn"]).catch(() => {});
      await pool.query("DELETE FROM organizations WHERE id = $1;", [testOrgId]).catch(() => {});
      setDatabasePool(null);
      await pool.end().catch(() => {});
    }
  }
});
