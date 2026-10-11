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

  // Nạp seed S-22
  seedS22InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
  });

  let distAgent;
  let inspAgent;
  let prodAgent;

  await t.test("0. Đăng nhập các tác nhân kiểm thử", async () => {
    distAgent = await loginAs("distributor_s30@agri.vn");
    inspAgent = await loginAs("inspector_s30@agri.vn");
    prodAgent = await loginAs("producer_s30@agri.vn");
    assert.ok(distAgent);
    assert.ok(inspAgent);
    assert.ok(prodAgent);
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
});
