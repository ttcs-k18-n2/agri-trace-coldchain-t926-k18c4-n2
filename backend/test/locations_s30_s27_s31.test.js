const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  setDatabasePool,
} = require("../src/server");
const { seedS22InMemory } = require("../scripts/seed_s22");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Sprint 4: Bộ kiểm thử tích hợp Story S-30 (Địa điểm), S-27 (Vị trí & Khối lượng hậu duệ), S-31 (Nhật ký thao tác)", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Cài đặt tài khoản test
  users.set("distributor_s30@agri.vn", {
    id: "usr-s30-dist",
    email: "distributor_s30@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    roleId: "distributor",
    organizationId: "org-dist",
  });

  users.set("inspector_s30@agri.vn", {
    id: "usr-s30-insp",
    email: "inspector_s30@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    roleId: "inspector",
    organizationId: "org-inspector",
  });

  users.set("producer_s30@agri.vn", {
    id: "usr-s30-prod",
    email: "producer_s30@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    roleId: "producer",
    organizationId: "org-001",
  });

  users.set("admin_s30@agri.vn", {
    id: "usr-s30-admin",
    email: "admin_s30@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    roleId: "admin",
    organizationId: "org-001",
    isAdmin: true,
  });

  // Nạp seed S-22
  seedS22InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
  });

  let distAgent;
  let inspAgent;
  let prodAgent;
  let adminAgent;

  await t.test("0. Đăng nhập các tác nhân kiểm thử", async () => {
    distAgent = await loginAs("distributor_s30@agri.vn");
    inspAgent = await loginAs("inspector_s30@agri.vn");
    prodAgent = await loginAs("producer_s30@agri.vn");
    adminAgent = await loginAs("admin_s30@agri.vn");
    assert.ok(distAgent);
    assert.ok(inspAgent);
    assert.ok(prodAgent);
    assert.ok(adminAgent);
  });

  let createdLocationId = null;

  // --- Story S-30: Quản lý địa điểm / cửa hàng ---
  await t.test("1. S-30: Lấy danh sách địa điểm theo quyền Multi-tenant (GET /api/locations)", async () => {
    // Distributor chỉ thấy địa điểm của org-dist
    const resDist = await distAgent.get("/api/locations");
    assert.equal(resDist.status, 200);
    assert.ok(Array.isArray(resDist.body.locations));
    for (const loc of resDist.body.locations) {
      assert.equal(loc.organizationId, "org-dist");
    }

    // Inspector thấy toàn bộ địa điểm của mọi tổ chức
    const resInsp = await inspAgent.get("/api/locations");
    assert.equal(resInsp.status, 200);
    assert.ok(resInsp.body.locations.length >= resDist.body.locations.length);
  });

  await t.test("2. S-30: Tạo mới địa điểm kho / cửa hàng bán lẻ (POST /api/locations)", async () => {
    const payload = {
      name: "Kho Lạnh Trung Tâm Cầu Giấy Test",
      address: "Số 99 Đường Xuân Thủy, Cầu Giấy, Hà Nội",
      locationType: "cold_storage",
      contactPerson: "Anh Quản Kho",
      phone: "0988776655",
      coordinates: { lat: 21.036, lng: 105.782 },
    };

    const res = await distAgent.post("/api/locations").send(payload);
    assert.equal(res.status, 201);
    assert.ok(res.body.location);
    assert.equal(res.body.location.name, payload.name);
    assert.equal(res.body.location.organizationId, "org-dist");
    assert.equal(res.body.location.locationType, "cold_storage");
    createdLocationId = res.body.location.id;
  });

  await t.test("3. S-30: Chặn tạo địa điểm khi tên rỗng (400 INVALID_NAME)", async () => {
    const res = await distAgent.post("/api/locations").send({ name: "   " });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "INVALID_NAME");
  });

  await t.test("4. S-30: Cập nhật vị trí lưu kho của lô hàng (PATCH /api/lots/:id/location)", async () => {
    // Gán vị trí cho lô L05 (thuộc org-dist hoặc phân phối)
    const lotL05 = inMemoryLots.find((l) => l.id === "L05");
    if (lotL05) lotL05.organizationId = "org-dist";

    const res = await distAgent
      .patch("/api/lots/L05/location")
      .send({ locationId: createdLocationId });
    assert.equal(res.status, 200);
    assert.equal(res.body.locationId, createdLocationId);

    // Xác nhận sự kiện LOCATION_CHANGED được ghi vào chuỗi hash-chain batch_events (S-30 P0)
    assert.ok(res.body.event, "Phải trả về đối tượng sự kiện hash-chain");
    assert.equal(res.body.event.eventType, "LOCATION_CHANGED");
    assert.equal(res.body.event.batchId, "L05");
    assert.equal(res.body.event.payload.newLocationId, createdLocationId);
    assert.match(res.body.event.eventHash, /^[0-9a-f]{64}$/i, "eventHash phải là chuỗi SHA-256 hợp lệ");
    assert.ok(res.body.event.previousHash, "previousHash phải tồn tại");

    const eventInStore = inMemoryBatchEvents.find(
      (e) => (e.batch_id === "L05" || e.batchId === "L05") && (e.event_type === "LOCATION_CHANGED" || e.eventType === "LOCATION_CHANGED")
    );
    assert.ok(eventInStore, "Sự kiện LOCATION_CHANGED phải được lưu vào sổ cái batch_events");

    // Xác nhận GET /api/lots/:id trả về đầy đủ vị trí lưu kho
    const getLotRes = await distAgent.get("/api/lots/L05");
    assert.equal(getLotRes.status, 200);
    assert.equal(getLotRes.body.lot.locationId, createdLocationId);
    assert.equal(getLotRes.body.lot.locationName, "Kho Lạnh Trung Tâm Cầu Giấy Test");
  });

  // --- Story S-27: Vị trí và khối lượng cho mỗi hậu duệ ---
  await t.test("5. S-27: API Truy xuôi hậu duệ trả về đầy đủ vị trí lưu kho và khối lượng tồn kho", async () => {
    const res = await inspAgent.get("/api/lots/L02/descendants");
    assert.equal(res.status, 200);

    const descendants = res.body.descendants;
    assert.ok(Array.isArray(descendants));
    assert.ok(descendants.length > 0);

    // Kiểm tra cấu trúc S-27 cho từng hậu duệ
    for (const d of descendants) {
      assert.ok(d.id, "Mỗi hậu duệ phải có id");
      assert.ok(Object.prototype.hasOwnProperty.call(d, "remainingQuantity"), "Mỗi hậu duệ phải có remainingQuantity");
      assert.ok(Object.prototype.hasOwnProperty.call(d, "locationName"), "Mỗi hậu duệ phải có locationName");
      assert.ok(d.productUnit, "Mỗi hậu duệ phải có đơn vị tính productUnit");
    }

    // Kiểm tra thống kê tóm tắt theo địa điểm (locationSummary)
    assert.ok(Array.isArray(res.body.locationSummary));
    assert.ok(res.body.locationSummary.length > 0);
    const locSum = res.body.locationSummary[0];
    assert.ok(locSum.locationName);
    assert.ok(Object.prototype.hasOwnProperty.call(locSum, "totalLots"));
    assert.ok(Object.prototype.hasOwnProperty.call(locSum, "totalRemainingQuantity"));
  });

  await t.test("6. S-27: API Báo cáo tóm tắt hậu duệ (GET /api/lots/:id/descendants-summary)", async () => {
    const res = await inspAgent.get("/api/lots/L02/descendants-summary");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L02");
    assert.ok(Array.isArray(res.body.locationSummary));
    assert.ok(Array.isArray(res.body.descendants));
    assert.ok(res.body.descendantCount > 0);
  });

  // --- Story S-31: Nhật ký thao tác nghiệp vụ (Audit Logs) ---
  await t.test("7. S-31: Inspector tra cứu nhật ký thao tác nghiệp vụ (GET /api/audit-logs)", async () => {
    const res = await inspAgent.get("/api/audit-logs");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.logs));
    assert.ok(res.body.total >= 1);

    // Phải ghi nhận hành động LOCATION_CREATED hoặc LOT_LOCATION_UPDATED đã thực hiện ở trên
    const foundAction = res.body.logs.some(
      (l) => l.action === "LOCATION_CREATED" || l.action === "LOT_LOCATION_UPDATED"
    );
    assert.ok(foundAction, "Audit logs phải ghi nhận thao tác nghiệp vụ vừa diễn ra");
  });

  await t.test("8. S-31: Chặn người dùng không có quyền (Producer/Cooperative) xem audit logs (403 Forbidden)", async () => {
    const res = await prodAgent.get("/api/audit-logs");
    assert.equal(res.status, 403);
  });

  // --- Story S-30: Ràng buộc tổ chức đối với Admin ---
  await t.test("9. S-30: Quyền Admin vẫn bị chặn khi gán kho thuộc tổ chức khác vào lô hàng (403 LOCATION_ORG_MISMATCH)", async () => {
    // Lô L05 thuộc org-dist, nhưng kho LOC-WH-TN-01 thuộc org-001
    const res = await adminAgent
      .patch("/api/lots/L05/location")
      .send({ locationId: "LOC-WH-TN-01" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "LOCATION_ORG_MISMATCH");
    assert.match(res.body.message, /không thuộc quyền quản lý của tổ chức sở hữu lô hàng/);
  });

  // --- Story S-30 / S-17: Tách lô ra nhiều cửa hàng / điểm bán lẻ ---
  await t.test("10. S-30 / S-17: Tách lô hàng và chỉ định vị trí cửa hàng cho từng lô con trong cùng 1 request", async () => {
    // Chuẩn bị một lô mẹ thuộc org-dist
    inMemoryLots.push({
      id: "LOT-MULTI-STORE-01",
      name: "Lô Rau Hỗn Hợp Bán Lẻ",
      status: "Đang lưu kho",
      organizationId: "org-dist",
      productId: "PROD-VEG-01",
      initialQuantity: 100,
      remainingQuantity: 100,
      createdAt: new Date().toISOString(),
    });

    const splitPayload = {
      splits: [
        {
          name: "Rau sạch - Cửa hàng Cầu Giấy",
          quantity: 40,
          locationId: "LOC-STORE-HN-01",
          notes: "Giao ca sáng",
        },
        {
          name: "Rau sạch - Cửa hàng Thanh Xuân",
          quantity: 35,
          locationId: "LOC-STORE-HN-02",
          notes: "Giao ca chiều",
        },
      ],
    };

    const res = await distAgent
      .post("/api/lots/LOT-MULTI-STORE-01/split")
      .send(splitPayload);

    assert.equal(res.status, 201);
    assert.equal(res.body.parentLot.remainingQuantity, 25);
    assert.equal(res.body.childLots.length, 2);

    // Xác nhận locationId được gán chính xác cho từng lô con
    assert.equal(res.body.childLots[0].locationId, "LOC-STORE-HN-01");
    assert.equal(res.body.childLots[1].locationId, "LOC-STORE-HN-02");

    // Xác nhận API GET chi tiết lô con trả về đúng locationId và tên cửa hàng
    const child1Id = res.body.childLots[0].id;
    const child2Id = res.body.childLots[1].id;
    const getChild1Res = await distAgent.get(`/api/lots/${child1Id}`);
    assert.equal(getChild1Res.status, 200);
    assert.equal(getChild1Res.body.lot.locationId, "LOC-STORE-HN-01");

    const getChild2Res = await distAgent.get(`/api/lots/${child2Id}`);
    assert.equal(getChild2Res.status, 200);
    assert.equal(getChild2Res.body.lot.locationId, "LOC-STORE-HN-02");

    // Xác nhận API truy xuôi hậu duệ (S-27) gom nhóm đúng cả 2 cửa hàng
    const descRes = await inspAgent.get("/api/lots/LOT-MULTI-STORE-01/descendants");
    assert.equal(descRes.status, 200);
    assert.equal(descRes.body.descendantCount, 2);

    const locIds = descRes.body.locationSummary.map((s) => s.locationId);
    assert.ok(locIds.includes("LOC-STORE-HN-01"));
    assert.ok(locIds.includes("LOC-STORE-HN-02"));
  });

  await t.test("11. S-30 / S-17: Chặn tách lô khi chỉ định kho không tồn tại hoặc kho khác tổ chức", async () => {
    // Thử kho không tồn tại
    const resNotFound = await distAgent
      .post("/api/lots/LOT-MULTI-STORE-01/split")
      .send({
        splits: [
          { name: "Lô con lỗi 1", quantity: 5, locationId: "LOC-NON-EXISTENT" },
        ],
      });
    assert.equal(resNotFound.status, 404);
    assert.equal(resNotFound.body.error, "LOCATION_NOT_FOUND");

    // Thử kho của tổ chức khác (LOC-WH-TN-01 thuộc org-001, trong khi lô thuộc org-dist)
    const resMismatch = await distAgent
      .post("/api/lots/LOT-MULTI-STORE-01/split")
      .send({
        splits: [
          { name: "Lô con lỗi 2", quantity: 5, locationId: "LOC-WH-TN-01" },
        ],
      });
    assert.equal(resMismatch.status, 403);
    assert.equal(resMismatch.body.error, "LOCATION_ORG_MISMATCH");
  });

  // --- Story S-31: Tính nguyên tử và Rollback khi Audit Log gặp sự cố ---
  await t.test("12. S-31: Đảm bảo tính nguyên tử - Rollback hoàn toàn khi ghi audit log thất bại trong transaction", async () => {
    const { recordAuditLog } = require("../src/audit_logger");

    // Giả lập một transaction client mà lệnh insert audit log gặp lỗi
    const fakeClient = {
      query: async (sql) => {
        if (typeof sql === "string" && sql.includes("INSERT INTO audit_logs")) {
          throw new Error("Simulated Database Disk Full for Audit Log");
        }
        return { rows: [] };
      },
    };

    // Khi truyền client transaction, recordAuditLog bắt buộc phải throw để kích hoạt ROLLBACK
    await assert.rejects(
      async () => {
        await recordAuditLog({
          client: fakeClient,
          action: "TEST_ATOMIC_FAIL",
          resourceType: "lot",
          resourceId: "LOT-TEST",
        });
      },
      (err) => {
        assert.match(err.message, /Audit log persistence failed/);
        return true;
      },
      "Phải ném lỗi khi ghi audit log thất bại trên transaction client để kích hoạt rollback"
    );
  });

  await t.test("13. S-31: Bộ lọc đa tiêu chí và phân trang nhật ký kiểm toán (GET /api/audit-logs)", async () => {
    // Truy vấn với bộ lọc action
    const resFiltered = await inspAgent.get("/api/audit-logs?action=LOT_LOCATION_UPDATED");
    assert.equal(resFiltered.status, 200);
    assert.ok(Array.isArray(resFiltered.body.logs));
    for (const log of resFiltered.body.logs) {
      assert.equal(log.action, "LOT_LOCATION_UPDATED");
    }

    // Truy vấn với limit và offset
    const resPaged = await inspAgent.get("/api/audit-logs?limit=2&offset=0");
    assert.equal(resPaged.status, 200);
    assert.equal(resPaged.body.limit, 2);
    assert.equal(resPaged.body.offset, 0);
    assert.ok(resPaged.body.logs.length <= 2);

    // Truy vấn với search keyword (tìm theo resourceId / actor / action)
    const resSearch = await inspAgent.get("/api/audit-logs?search=LOT");
    assert.equal(resSearch.status, 200);
    assert.ok(Array.isArray(resSearch.body.logs));
  });

  await t.test("14. S-31: Đảm bảo tính chỉ-thêm (Append-Only) - Không cho phép chỉnh sửa hoặc xóa audit logs qua API", async () => {
    // Không có endpoint DELETE /api/audit-logs
    const resDelete = await inspAgent.delete("/api/audit-logs");
    assert.ok(resDelete.status === 404 || resDelete.status === 405);

    // Không có endpoint PUT/PATCH /api/audit-logs/:id
    const resPatch = await inspAgent.patch("/api/audit-logs/audit-123").send({ action: "ALTERED" });
    assert.ok(resPatch.status === 404 || resPatch.status === 405);
  });

  await t.test("15. S-30 & S-31: Kiểm thử thực tế trên PostgreSQL: luồng đổi kho, hash-chain và tìm kiếm audit log", async (ctx) => {
    const dbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      ctx.skip("Bỏ qua do không có DATABASE_URL trên môi trường hiện tại");
      return;
    }

    const { Pool } = require("pg");
    const testPool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
    let isConnected = false;
    try {
      await testPool.query("SELECT 1;");
      isConnected = true;
    } catch {
      isConnected = false;
    }

    if (!isConnected) {
      ctx.skip("PostgreSQL không khả dụng hoặc không kết nối được trên môi trường cục bộ");
      await testPool.end().catch(() => {});
      return;
    }

    // Kết nối thành công -> Chạy kiểm thử thực tế KHÔNG swallow assertion trong catch!
    setDatabasePool(testPool);

    const testOrgId = "org-s30-pg-test";
    const testOtherOrgId = "org-s30-other-test";
    const testUserId = "usr-s30-pg-user";
    const testUserEmail = "s30_pg_user@agri.vn";
    const testLotId = "LOT-S30-PG-TEST";
    const testLoc1Id = "LOC-S30-PG-1";
    const testLoc2Id = "LOC-S30-PG-2";
    const testOtherLocId = "LOC-S30-DIFF-ORG";

    try {
      // 1. Dọn dẹp dữ liệu cũ nếu có
      await testPool.query("DELETE FROM audit_logs WHERE resource_id = $1;", [testLotId]);
      await testPool.query("DELETE FROM batch_events WHERE batch_id = $1;", [testLotId]);
      await testPool.query("DELETE FROM lots WHERE id = $1;", [testLotId]);
      await testPool.query("DELETE FROM locations WHERE id IN ($1, $2, $3);", [testLoc1Id, testLoc2Id, testOtherLocId]);
      await testPool.query("DELETE FROM users WHERE id = $1 OR email = $2;", [testUserId, testUserEmail]);
      await testPool.query("DELETE FROM organizations WHERE id IN ($1, $2);", [testOrgId, testOtherOrgId]);

      // 2. Tạo tổ chức và người dùng
      await testPool.query(
        "INSERT INTO organizations (id, name, type) VALUES ($1, $2, $3), ($4, $5, $6) ON CONFLICT (id) DO NOTHING;",
        [testOrgId, "Hợp tác xã S30 PG Test", "distributor", testOtherOrgId, "Tổ chức khác Test", "distributor"]
      );

      const passHash = await hashPassword("Password123!");
      await testPool.query(
        "INSERT INTO users (id, email, password_hash, organization_id, role_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING;",
        [testUserId, testUserEmail, passHash, testOrgId, "distributor"]
      );

      // Cập nhật users in-memory map để middleware xác thực tìm thấy user
      users.set(testUserEmail, {
        id: testUserId,
        email: testUserEmail,
        passwordHash: passHash,
        failedCount: 0,
        lockedUntil: null,
        roleId: "distributor",
        organizationId: testOrgId,
      });

      // 3. Tạo các địa điểm lưu kho
      await testPool.query(
        "INSERT INTO locations (id, name, organization_id, location_type, address) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15);",
        [
          testLoc1Id, "Kho Khởi Đầu PG", testOrgId, "warehouse", "123 Đường A",
          testLoc2Id, "Cửa Hàng Bán Lẻ PG", testOrgId, "retail_store", "456 Đường B",
          testOtherLocId, "Kho Tổ Chức Khác", testOtherOrgId, "warehouse", "789 Đường C"
        ]
      );

      // 4. Tạo sản phẩm mẫu và lô hàng ban đầu
      await testPool.query(
        "INSERT INTO products (id, name, unit) VALUES ('PROD-S30-TEST', 'Sản phẩm Test S30', 'kg') ON CONFLICT (id) DO NOTHING;"
      );
      await testPool.query(
        "INSERT INTO lots (id, name, product_id, organization_id, initial_quantity, remaining_quantity, status, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);",
        [testLotId, "Lô Nông Sản PG S30", "PROD-S30-TEST", testOrgId, 100, 100, "Đang lưu kho", testLoc1Id]
      );

      // Tạo sự kiện gốc HARVEST_CREATED để chuỗi băm có previous_hash
      const { computeEventHash } = require("../src/event_repository");
      const initPayload = { note: "Khởi tạo lô test" };
      const initDate = new Date();
      const initHash = computeEventHash({
        batchId: testLotId,
        eventType: "HARVEST_CREATED",
        payload: initPayload,
        previousHash: "0".repeat(64),
        sequenceNo: 1,
        organizationId: testOrgId,
        actorUserId: testUserId,
        occurredAt: initDate,
      });
      await testPool.query(
        "INSERT INTO batch_events (id, batch_id, sequence_no, event_type, payload, organization_id, actor_user_id, occurred_at, previous_hash, event_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);",
        [`evt-s30-init-${Date.now()}`, testLotId, 1, "HARVEST_CREATED", JSON.stringify(initPayload), testOrgId, testUserId, initDate, "0".repeat(64), initHash]
      );

      // 5. Đăng nhập qua session
      const pgUserAgent = await loginAs(testUserEmail);

      // --- KIỂM THỬ THỰC TẾ 1: Đổi kho thành công, ghi hash-chain xuống PostgreSQL ---
      const resUpdate = await pgUserAgent
        .patch(`/api/lots/${testLotId}/location`)
        .send({ locationId: testLoc2Id });

      assert.equal(resUpdate.status, 200, "Đổi kho phải thành công với mã HTTP 200");
      assert.equal(resUpdate.body.locationId, testLoc2Id);
      assert.ok(resUpdate.body.event, "API phải trả về sự kiện LOCATION_CHANGED");
      assert.equal(resUpdate.body.event.eventType, "LOCATION_CHANGED");
      assert.match(resUpdate.body.event.eventHash, /^[0-9a-f]{64}$/i, "eventHash phải là SHA-256 hợp lệ");
      assert.equal(resUpdate.body.event.previousHash, initHash, "previousHash phải nối chuỗi từ sự kiện liền trước");

      // Đối chiếu trực tiếp bảng lots trong PostgreSQL
      const dbLotRes = await testPool.query("SELECT location_id FROM lots WHERE id = $1;", [testLotId]);
      assert.equal(dbLotRes.rows[0].location_id, testLoc2Id, "lots.location_id trong PostgreSQL phải được cập nhật");

      // Đối chiếu trực tiếp bảng batch_events trong PostgreSQL
      const dbEventRes = await testPool.query(
        "SELECT event_type, payload, event_hash, previous_hash FROM batch_events WHERE batch_id = $1 AND event_type = 'LOCATION_CHANGED' ORDER BY created_at DESC LIMIT 1;",
        [testLotId]
      );
      assert.equal(dbEventRes.rowCount, 1, "batch_events trong PostgreSQL phải có đúng sự kiện LOCATION_CHANGED");
      assert.equal(dbEventRes.rows[0].payload.newLocationId, testLoc2Id);
      assert.equal(dbEventRes.rows[0].previous_hash, initHash);
      assert.equal(dbEventRes.rows[0].event_hash, resUpdate.body.event.eventHash);

      // --- KIỂM THỬ THỰC TẾ 2: S-31 Tìm kiếm nhật ký kiểm toán trên PostgreSQL (xác minh fix LOWER(id::text)) ---
      const resSearch = await inspAgent.get(`/api/audit-logs?search=${testLotId}`);
      assert.equal(resSearch.status, 200, "Truy vấn tìm kiếm nhật ký trên PostgreSQL phải trả về HTTP 200 mà không ném lỗi cú pháp UUID");
      assert.ok(Array.isArray(resSearch.body.logs));
      const foundAudit = resSearch.body.logs.find((l) => l.resourceId === testLotId);
      assert.ok(foundAudit, "Phải tìm thấy audit log vừa tạo cho lô hàng test trên PostgreSQL");
      assert.equal(foundAudit.action, "LOT_LOCATION_UPDATED");

      // --- KIỂM THỬ THỰC TẾ 3: Rollback nguyên tử khi cập nhật địa điểm khác tổ chức ---
      const resFail = await pgUserAgent
        .patch(`/api/lots/${testLotId}/location`)
        .send({ locationId: testOtherLocId });

      assert.equal(resFail.status, 403, "Cập nhật kho khác tổ chức phải bị từ chối HTTP 403");
      assert.equal(resFail.body.error, "LOCATION_ORG_MISMATCH");

      // --- KIỂM THỬ THỰC TẾ 4: Rollback nguyên tử khi ghi audit log thất bại trong giao dịch PostgreSQL ---
      // Tạo trigger tạm thời trên PostgreSQL để mô phỏng lỗi khi ghi audit log cho lô hàng này
      await testPool.query(`
        CREATE OR REPLACE FUNCTION trigger_fail_audit_fn() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Simulated Audit Log Database Write Failure';
        END;
        $$ LANGUAGE plpgsql;
      `);
      await testPool.query(`
        DROP TRIGGER IF EXISTS trg_fail_audit_logs ON audit_logs;
        CREATE TRIGGER trg_fail_audit_logs
        BEFORE INSERT ON audit_logs
        FOR EACH ROW
        WHEN (NEW.action = 'LOT_LOCATION_UPDATED' AND NEW.resource_id = '${testLotId}')
        EXECUTE FUNCTION trigger_fail_audit_fn();
      `);

      try {
        const resAuditFail = await pgUserAgent
          .patch(`/api/lots/${testLotId}/location`)
          .send({ locationId: testLoc1Id });

        assert.equal(resAuditFail.status, 500, "Khi ghi audit log thất bại trong transaction, API phải trả về HTTP 500");
        assert.match(resAuditFail.body.message, /Audit log persistence failed/);

        // Xác minh trong PostgreSQL:
        // 1. lots.location_id không bị đổi sang testLoc1Id (vẫn giữ nguyên testLoc2Id)
        const dbLotAuditFailCheck = await testPool.query("SELECT location_id FROM lots WHERE id = $1;", [testLotId]);
        assert.equal(dbLotAuditFailCheck.rows[0].location_id, testLoc2Id, "Lô hàng không bị đổi kho khi audit log thất bại (Transaction Rollback)");

        // 2. Sự kiện LOCATION_CHANGED bổ sung bị rollback, số lượng event không tăng
        const dbEventsCheck = await testPool.query(
          "SELECT COUNT(*) as count FROM batch_events WHERE batch_id = $1 AND event_type = 'LOCATION_CHANGED';",
          [testLotId]
        );
        assert.equal(Number(dbEventsCheck.rows[0].count), 1, "Sự kiện LOCATION_CHANGED trong transaction lỗi phải được rollback hoàn toàn");
      } finally {
        await testPool.query("DROP TRIGGER IF EXISTS trg_fail_audit_logs ON audit_logs;").catch(() => {});
        await testPool.query("DROP FUNCTION IF EXISTS trigger_fail_audit_fn();").catch(() => {});
      }
    } finally {
      // Dọn dẹp dữ liệu test
      await testPool.query("DROP TRIGGER IF EXISTS trg_fail_audit_logs ON audit_logs;").catch(() => {});
      await testPool.query("DROP FUNCTION IF EXISTS trigger_fail_audit_fn();").catch(() => {});
      await testPool.query("DELETE FROM audit_logs WHERE resource_id = $1;", [testLotId]).catch(() => {});
      await testPool.query("DELETE FROM batch_events WHERE batch_id = $1;", [testLotId]).catch(() => {});
      await testPool.query("DELETE FROM lots WHERE id = $1;", [testLotId]).catch(() => {});
      await testPool.query("DELETE FROM locations WHERE id IN ($1, $2, $3);", [testLoc1Id, testLoc2Id, testOtherLocId]).catch(() => {});
      await testPool.query("DELETE FROM users WHERE id = $1 OR email = $2;", [testUserId, testUserEmail]).catch(() => {});
      await testPool.query("DELETE FROM organizations WHERE id IN ($1, $2);", [testOrgId, testOtherOrgId]).catch(() => {});
      setDatabasePool(null);
      await testPool.end().catch(() => {});
    }
  });
});

