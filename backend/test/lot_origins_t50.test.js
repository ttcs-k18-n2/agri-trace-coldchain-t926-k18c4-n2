const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryFarms,
  seedS22Data,
  clearLotOriginsCache,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("T-50 API Endpoint, Cache 60s & Multi-tenant S-23 Access Control (GET /api/lots/:id/origins)", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  users.set("org_a_user@org.vn", {
    id: "usr-org-a",
    email: "org_a_user@org.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "cooperative",
  });

  users.set("org_b_user@org.vn", {
    id: "usr-org-b",
    email: "org_b_user@org.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-B",
    roleId: "producer",
  });

  users.set("org_c_user@org.vn", {
    id: "usr-org-c",
    email: "org_c_user@org.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-C",
    roleId: "distributor",
  });

  users.set("inspector_gov@gov.vn", {
    id: "usr-insp-s22",
    email: "inspector_gov@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  // Setup seed S-22
  seedS22Data();
  clearLotOriginsCache();

  const orgAAgent = await loginAs("org_a_user@org.vn");
  const orgBAgent = await loginAs("org_b_user@org.vn");
  const orgCAgent = await loginAs("org_c_user@org.vn");
  const inspectorAgent = await loginAs("inspector_gov@gov.vn");

  await t.test("1. Endpoint GET /api/lots/:id/origins trả về đầy đủ rootLots (vùng trồng) và levels cho lô gộp L10", async () => {
    clearLotOriginsCache("L10");
    const res = await orgCAgent.get("/api/lots/L10/origins");

    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L10");
    assert.equal(res.body.isRoot, false);
    assert.equal(res.body.cached, false);
    assert.equal(res.body.totalAncestors, 4);

    // rootLots: L02 và L04
    assert.equal(res.body.rootLots.length, 2);
    const rootIds = res.body.rootLots.map((r) => r.id);
    assert.ok(rootIds.includes("L02"));
    assert.ok(rootIds.includes("L04"));

    const l02Root = res.body.rootLots.find((r) => r.id === "L02");
    assert.ok(l02Root.farm);
    assert.equal(l02Root.farm.name, "Thửa canh tác Hợp tác xã A");
    assert.equal(l02Root.farm.area, 3.5);
    assert.equal(l02Root.farm.coordinates, "21.5645, 105.6789");

    // levels: đúng 2 tầng
    assert.equal(res.body.levels.length, 2);
    assert.equal(res.body.levels[0].level, 1);
    assert.equal(res.body.levels[1].level, 2);
  });

  await t.test("2. NFR Cache 60s: Gọi lại lần 2 trả về cached = true và response nhanh", async () => {
    // Request lần 2 trong vòng 60s
    const res = await orgCAgent.get("/api/lots/L10/origins");

    assert.equal(res.status, 200);
    assert.equal(res.body.cached, true, "Lần thứ 2 phải trả về kết quả từ cache");
    assert.ok(res.body.cachedAt, "Phải có cachedAt");
  });

  await t.test("3. AC3: Lô gốc F0 L01 trả về chính nó là root lot duy nhất, levels rỗng", async () => {
    const res = await orgAAgent.get("/api/lots/L01/origins");

    assert.equal(res.status, 200);
    assert.equal(res.body.isRoot, true);
    assert.equal(res.body.levels.length, 0);
    assert.equal(res.body.rootLots.length, 1);
    assert.equal(res.body.rootLots[0].id, "L01");
    assert.ok(res.body.rootLots[0].farm);
    assert.equal(res.body.rootLots[0].farm.name, "Thửa canh tác Hợp tác xã A");
  });

  await t.test("4. S-23 / T-54 Access Control: Tổ chức hạ nguồn (ORG-C) xem được nguồn gốc lô tổ tiên (L02, L01)", async () => {
    // ORG-C nắm L10 (hậu duệ của L02 và L05) -> ORG-C có quyền xem nguồn gốc L02
    const res = await orgCAgent.get("/api/lots/L02/origins");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L02");
  });

  await t.test("5. S-23 Access Control: Chặn 403 Forbidden nếu tổ chức không liên quan truy cập", async () => {
    // Giả lập lô độc lập hoàn toàn LOT-UNRELATED thuộc ORG-A
    inMemoryLots.push({
      id: "LOT-SECRET-A",
      name: "Bí mật ORG-A",
      status: "Đã thu hoạch",
      organizationId: "ORG-A",
      parentLotId: null,
      productId: "PROD-TOMATO",
      farmId: "FARM-ORG-A",
    });

    // ORG-B không có liên kết nào đến LOT-SECRET-A
    const res = await orgBAgent.get("/api/lots/LOT-SECRET-A/origins");
    assert.equal(res.status, 403);
    assert.match(res.body.message, /bị từ chối/i);
  });

  await t.test("6. Inspector / Admin có quyền truy cập toàn cục mọi lô hàng", async () => {
    const res = await inspectorAgent.get("/api/lots/LOT-SECRET-A/origins");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "LOT-SECRET-A");
  });
});
