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
  inMemoryOrgs,
  inMemoryProducts,
  inMemoryFarms,
} = require("../src/server");
const { seedS22InMemory } = require("../scripts/seed_s22");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("API GET /api/lots/:id/descendants & /api/lots/:id/trace-forward (S-23 RBAC & Chuẩn hóa Response)", async (t) => {
  // Cài đặt dữ liệu người dùng và seed S22
  const passwordHash = await hashPassword("Password123!");

  users.set("producer@org1.vn", {
    id: "usr-prod-a",
    email: "producer@org1.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "producer",
  });

  users.set("coop@org2.vn", {
    id: "usr-coop-b",
    email: "coop@org2.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-B",
    roleId: "cooperative",
  });

  users.set("dist@org3.vn", {
    id: "usr-dist-c",
    email: "dist@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-C",
    roleId: "distributor",
  });

  users.set("inspector@gov.vn", {
    id: "usr-insp-gov",
    email: "inspector@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("unrelated@other.vn", {
    id: "usr-unrelated",
    email: "unrelated@other.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-UNRELATED",
    roleId: "producer",
  });

  seedS22InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
    inMemoryOrgs,
    inMemoryProducts,
    inMemoryFarms,
  });

  const producerAgent = await loginAs("producer@org1.vn");
  const coopAgent = await loginAs("coop@org2.vn");
  const distAgent = await loginAs("dist@org3.vn");
  const inspectorAgent = await loginAs("inspector@gov.vn");
  const unrelatedAgent = await loginAs("unrelated@other.vn");

  await t.test("1. Cấu trúc Response chuẩn theo đặc tả cho GET /api/lots/L02/descendants", async () => {
    const res = await producerAgent.get("/api/lots/L02/descendants");
    assert.equal(res.status, 200);

    const body = res.body;
    assert.equal(body.lotId, "L02");
    assert.ok(body.startLot);
    assert.equal(body.startLot.id, "L02");
    assert.equal(body.startLot.organizationId, "ORG-A");
    assert.equal(body.isLeaf, false);
    assert.equal(body.totalDescendants, 4);
    assert.equal(body.descendantCount, 4);
    assert.deepEqual(new Set(body.descendantIds), new Set(["L05", "L06", "L10", "L11"]));

    // Kiểm tra cấu trúc levels
    assert.ok(Array.isArray(body.levels));
    assert.equal(body.levels.length, 2);

    // Tầng 1
    assert.equal(body.levels[0].level, 1);
    assert.ok(Array.isArray(body.levels[0].lots));
    const lvl1Ids = body.levels[0].lots.map((l) => l.id);
    assert.ok(lvl1Ids.includes("L05"));
    assert.ok(lvl1Ids.includes("L06"));
    const l05 = body.levels[0].lots.find((l) => l.id === "L05");
    assert.equal(l05.relationType, "SPLIT");
    assert.equal(l05.organizationId, "ORG-B");
    assert.equal(l05.quantity, 200);

    // Tầng 2
    assert.equal(body.levels[1].level, 2);
    assert.ok(Array.isArray(body.levels[1].lots));
    const lvl2Ids = body.levels[1].lots.map((l) => l.id);
    assert.ok(lvl2Ids.includes("L10"));
    assert.ok(lvl2Ids.includes("L11"));
    const l10 = body.levels[1].lots.find((l) => l.id === "L10");
    assert.equal(l10.relationType, "MERGE");
    assert.equal(l10.organizationId, "ORG-C");
    assert.equal(l10.quantity, 100);

    // Kiểm tra danh sách phẳng descendants
    assert.ok(Array.isArray(body.descendants));
    assert.equal(body.descendants.length, 4);

    // Kiểm tra graph nodes & edges
    assert.ok(body.graph && Array.isArray(body.graph.nodes) && Array.isArray(body.graph.edges));
    assert.ok(body.graph.nodes.some((n) => n.id === "L02" && n.isCurrent === true));
    assert.ok(body.graph.edges.length > 0);

    // Kiểm tra executionTimeMs
    assert.ok(typeof body.executionTimeMs === "number");
    assert.ok(body.executionTimeMs >= 0);
  });

  await t.test("2. Hỗ trợ alias GET /api/lots/:id/trace-forward trả về đồng nhất", async () => {
    const res = await producerAgent.get("/api/lots/L02/trace-forward");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L02");
    assert.equal(res.body.totalDescendants, 4);
    assert.equal(res.body.levels.length, 2);
  });

  await t.test("3. Lô lá cuối cùng L10: isLeaf = true, totalDescendants = 0", async () => {
    const res = await distAgent.get("/api/lots/L10/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L10");
    assert.equal(res.body.isLeaf, true);
    assert.equal(bodyOrDefault(res.body.totalDescendants, 0), 0);
    assert.equal(res.body.levels.length, 0);
  });

  await t.test("4. Phân quyền Inspector / Admin: Toàn quyền truy xuất mọi lô và tổ chức", async () => {
    const res1 = await inspectorAgent.get("/api/lots/L01/descendants");
    assert.equal(res1.status, 200);

    const res2 = await inspectorAgent.get("/api/lots/L04/descendants");
    assert.equal(res2.status, 200);

    const res3 = await inspectorAgent.get("/api/lots/L10/descendants");
    assert.equal(res3.status, 200);
  });

  await t.test("5. Phân quyền Tổ chức: Được phép truy xuôi các lô trong chuỗi cung ứng của mình", async () => {
    // Org B (Coop) giữ L05, L06 (con của L02). Org B có quyền xem L02 qua quan hệ tổ tiên trong chuỗi
    const resB = await coopAgent.get("/api/lots/L02/descendants");
    assert.equal(resB.status, 200);

    // Org C (Distributor) giữ L10 (cháu của L02). Org C có quyền xem L02
    const resC = await distAgent.get("/api/lots/L02/descendants");
    assert.equal(resC.status, 200);
  });

  await t.test("6. Phân quyền Tổ chức không liên quan: Chặn 403 Forbidden", async () => {
    // Org không liên quan cố gắng truy cập L02
    const res = await unrelatedAgent.get("/api/lots/L02/descendants");
    assert.equal(res.status, 403);
    assert.match(res.body.message, /bị từ chối/i);
  });
});

function bodyOrDefault(val, def) {
  return val !== undefined && val !== null ? val : def;
}
