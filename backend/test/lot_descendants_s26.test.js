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
const { traceLotDescendants, CycleDetectedError } = require("../src/lot_genealogy");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

function eqSet(as, bs) {
  if (as.size !== bs.size) return false;
  for (const a of as) if (!bs.has(a)) return false;
  return true;
}

test("S-26 (Subtask Bước 5): Bộ Test Suite toàn diện Truy xuôi hậu duệ (lot_descendants_s26)", async (t) => {
  // Cài đặt tài khoản người dùng
  const passwordHash = await hashPassword("Password123!");

  users.set("producer_s26@agri.vn", {
    id: "usr-s26-prod-a",
    email: "producer_s26@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "producer",
  });

  users.set("coop_s26@agri.vn", {
    id: "usr-s26-coop-b",
    email: "coop_s26@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-B",
    roleId: "cooperative",
  });

  users.set("dist_s26@agri.vn", {
    id: "usr-s26-dist-c",
    email: "dist_s26@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-C",
    roleId: "distributor",
  });

  users.set("inspector_s26@agri.vn", {
    id: "usr-s26-inspector",
    email: "inspector_s26@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("unrelated_s26@agri.vn", {
    id: "usr-s26-unrelated",
    email: "unrelated_s26@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-UNRELATED",
    roleId: "producer",
  });

  // Nạp seed S-22
  seedS22InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
    inMemoryOrgs,
    inMemoryProducts,
    inMemoryFarms,
  });

  const inspectorAgent = await loginAs("inspector_s26@agri.vn");
  const producerAgent = await loginAs("producer_s26@agri.vn");
  const coopAgent = await loginAs("coop_s26@agri.vn");
  const distAgent = await loginAs("dist_s26@agri.vn");
  const unrelatedAgent = await loginAs("unrelated_s26@agri.vn");

  // ==========================================
  // 1. AC1 & ĐÁP ÁN ĐẾM TAY S-22 / T-53
  // ==========================================
  await t.test("1. AC1: L01 - Descendants kỳ vọng {L07}", async () => {
    const res = await inspectorAgent.get("/api/lots/L01/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L01");
    assert.equal(res.body.totalDescendants, 1);
    assert.equal(eqSet(new Set(res.body.descendantIds), new Set(["L07"])), true);
    assert.equal(res.body.isLeaf, false);
    assert.equal(res.body.levels.length, 1);
    assert.equal(res.body.levels[0].lots[0].id, "L07");
    assert.equal(res.body.levels[0].lots[0].relationType, "MERGE");
  });

  await t.test("2. AC1: L02 - Descendants kỳ vọng {L05, L06, L10, L11} (qua 2 tầng tách và gộp đa nguồn)", async () => {
    const res = await inspectorAgent.get("/api/lots/L02/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L02");
    assert.equal(res.body.totalDescendants, 4);
    assert.equal(eqSet(new Set(res.body.descendantIds), new Set(["L05", "L06", "L10", "L11"])), true);
    assert.equal(res.body.isLeaf, false);

    // Kiểm tra 2 tầng
    assert.equal(res.body.levels.length, 2);
    // Tầng 1: L05, L06 (SPLIT)
    const level1Ids = res.body.levels[0].lots.map((l) => l.id);
    assert.equal(eqSet(new Set(level1Ids), new Set(["L05", "L06"])), true);
    assert.ok(res.body.levels[0].lots.every((l) => l.relationType === "SPLIT"));

    // Tầng 2: L10, L11 (MERGE)
    const level2Ids = res.body.levels[1].lots.map((l) => l.id);
    assert.equal(eqSet(new Set(level2Ids), new Set(["L10", "L11"])), true);
    assert.ok(res.body.levels[1].lots.every((l) => l.relationType === "MERGE"));
  });

  await t.test("3. AC1: L04 - Descendants kỳ vọng {L08, L09, L10, L11}", async () => {
    const res = await inspectorAgent.get("/api/lots/L04/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L04");
    assert.equal(res.body.totalDescendants, 4);
    assert.equal(eqSet(new Set(res.body.descendantIds), new Set(["L08", "L09", "L10", "L11"])), true);
    assert.equal(res.body.levels.length, 2);
  });

  await t.test("4. AC1: L10 - Descendants kỳ vọng {} (lô lá cuối chuỗi)", async () => {
    const res = await inspectorAgent.get("/api/lots/L10/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L10");
    assert.equal(res.body.totalDescendants, 0);
    assert.equal(res.body.descendantIds.length, 0);
    assert.equal(res.body.isLeaf, true);
    assert.equal(res.body.levels.length, 0);
  });

  await t.test("5. AC1: L12 - Descendants kỳ vọng {} (lô độc lập)", async () => {
    const res = await inspectorAgent.get("/api/lots/L12/descendants");
    assert.equal(res.status, 200);
    assert.equal(res.body.lotId, "L12");
    assert.equal(res.body.totalDescendants, 0);
    assert.equal(res.body.descendantIds.length, 0);
    assert.equal(res.body.isLeaf, true);
    assert.equal(res.body.levels.length, 0);
  });

  // ==========================================
  // 2. AC2 & KIỂM SOÁT CHU TRÌNH VÀ KIM CƯƠNG
  // ==========================================
  await t.test("6. AC2: Dữ liệu vòng lặp giả lập LOT-A -> LOT-B -> LOT-C -> LOT-A (bắt CycleDetectedError, không treo server)", async () => {
    // Thêm quan hệ chu trình kín
    inMemoryLots.push(
      { id: "LOT-CYC-A", name: "Lô Chu Trình A", organizationId: "ORG-A", status: "Đã thu hoạch" },
      { id: "LOT-CYC-B", name: "Lô Chu Trình B", organizationId: "ORG-B", status: "Đã thu hoạch" },
      { id: "LOT-CYC-C", name: "Lô Chu Trình C", organizationId: "ORG-C", status: "Đã thu hoạch" }
    );
    inMemoryBatchRelations.push(
      { id: "rel-c-1", parentBatchId: "LOT-CYC-A", childBatchId: "LOT-CYC-B", relationType: "SPLIT", quantity: 10, organizationId: "ORG-A" },
      { id: "rel-c-2", parentBatchId: "LOT-CYC-B", childBatchId: "LOT-CYC-C", relationType: "SPLIT", quantity: 10, organizationId: "ORG-B" },
      { id: "rel-c-3", parentBatchId: "LOT-CYC-C", childBatchId: "LOT-CYC-A", relationType: "MERGE", quantity: 10, organizationId: "ORG-C" }
    );

    try {
      const res = await inspectorAgent.get("/api/lots/LOT-CYC-A/descendants");
      assert.equal(res.status, 422);
      assert.equal(res.body.error, "CYCLE_DETECTED");
      assert.equal(res.body.cycleLotId, "LOT-CYC-A");
      assert.match(res.body.message, /Phát hiện chu trình phả hệ tại lô LOT-CYC-A/);
      assert.ok(Array.isArray(res.body.path));
      assert.deepEqual(res.body.path, ["LOT-CYC-A", "LOT-CYC-B", "LOT-CYC-C", "LOT-CYC-A"]);
    } finally {
      // Dọn dẹp quan hệ chu trình
      const relIds = ["rel-c-1", "rel-c-2", "rel-c-3"];
      for (let i = inMemoryBatchRelations.length - 1; i >= 0; i--) {
        if (relIds.includes(inMemoryBatchRelations[i].id)) inMemoryBatchRelations.splice(i, 1);
      }
      const lotIds = ["LOT-CYC-A", "LOT-CYC-B", "LOT-CYC-C"];
      for (let i = inMemoryLots.length - 1; i >= 0; i--) {
        if (lotIds.includes(inMemoryLots[i].id)) inMemoryLots.splice(i, 1);
      }
    }
  });

  await t.test("7. AC2: Đồ thị kim cương (A tách B, C; B và C cùng gộp vào D): Kết quả không bị trùng lặp D", async () => {
    inMemoryLots.push(
      { id: "LOT-DIA-A", name: "Diamond Root A", organizationId: "ORG-A", status: "Đã thu hoạch" },
      { id: "LOT-DIA-B", name: "Diamond Branch B", organizationId: "ORG-B", status: "Đã thu hoạch" },
      { id: "LOT-DIA-C", name: "Diamond Branch C", organizationId: "ORG-B", status: "Đã thu hoạch" },
      { id: "LOT-DIA-D", name: "Diamond Converge D", organizationId: "ORG-C", status: "Đã thu hoạch" }
    );
    inMemoryBatchRelations.push(
      { id: "rel-dia-1", parentBatchId: "LOT-DIA-A", childBatchId: "LOT-DIA-B", relationType: "SPLIT", quantity: 50, organizationId: "ORG-A" },
      { id: "rel-dia-2", parentBatchId: "LOT-DIA-A", childBatchId: "LOT-DIA-C", relationType: "SPLIT", quantity: 50, organizationId: "ORG-A" },
      { id: "rel-dia-3", parentBatchId: "LOT-DIA-B", childBatchId: "LOT-DIA-D", relationType: "MERGE", quantity: 50, organizationId: "ORG-B" },
      { id: "rel-dia-4", parentBatchId: "LOT-DIA-C", childBatchId: "LOT-DIA-D", relationType: "MERGE", quantity: 50, organizationId: "ORG-B" }
    );

    try {
      const res = await inspectorAgent.get("/api/lots/LOT-DIA-A/descendants");
      assert.equal(res.status, 200);
      assert.equal(res.body.totalDescendants, 3);
      assert.equal(eqSet(new Set(res.body.descendantIds), new Set(["LOT-DIA-B", "LOT-DIA-C", "LOT-DIA-D"])), true);

      // Đảm bảo LOT-DIA-D chỉ xuất hiện 1 lần duy nhất trong danh sách phẳng
      const countD = res.body.descendants.filter((d) => d.id === "LOT-DIA-D").length;
      assert.equal(countD, 1);

      // Nhưng trong đồ thị (graph.edges) phải có đủ cả 2 cạnh liên kết dẫn vào D
      const edgesToD = res.body.graph.edges.filter((e) => e.target === "LOT-DIA-D");
      assert.equal(edgesToD.length, 2);
    } finally {
      const relIds = ["rel-dia-1", "rel-dia-2", "rel-dia-3", "rel-dia-4"];
      for (let i = inMemoryBatchRelations.length - 1; i >= 0; i--) {
        if (relIds.includes(inMemoryBatchRelations[i].id)) inMemoryBatchRelations.splice(i, 1);
      }
      const lotIds = ["LOT-DIA-A", "LOT-DIA-B", "LOT-DIA-C", "LOT-DIA-D"];
      for (let i = inMemoryLots.length - 1; i >= 0; i--) {
        if (lotIds.includes(inMemoryLots[i].id)) inMemoryLots.splice(i, 1);
      }
    }
  });

  // ==========================================
  // 3. KIỂM TRA PHÂN QUYỀN S-23 RBAC
  // ==========================================
  await t.test("8. S-23 RBAC: Inspector xem toàn bộ mọi lô", async () => {
    const resA = await inspectorAgent.get("/api/lots/L01/descendants");
    assert.equal(resA.status, 200);
    const resB = await inspectorAgent.get("/api/lots/L02/descendants");
    assert.equal(resB.status, 200);
    const resC = await inspectorAgent.get("/api/lots/L04/descendants");
    assert.equal(resC.status, 200);
  });

  await t.test("9. S-23 RBAC: Tổ chức sở hữu hoặc các bên trong chuỗi cung ứng truy xuất hợp lệ", async () => {
    // Producer (ORG-A) sở hữu L02 -> xem được
    const resProd = await producerAgent.get("/api/lots/L02/descendants");
    assert.equal(resProd.status, 200);

    // Coop (ORG-B) giữ L05/L06 (con của L02) -> xem được
    const resCoop = await coopAgent.get("/api/lots/L02/descendants");
    assert.equal(resCoop.status, 200);

    // Dist (ORG-C) giữ L10 (cháu của L02) -> xem được
    const resDist = await distAgent.get("/api/lots/L02/descendants");
    assert.equal(resDist.status, 200);
  });

  await t.test("10. S-23 RBAC: Bên ngoài chuỗi cung ứng bị chặn 403 Forbidden", async () => {
    const resUnrelated = await unrelatedAgent.get("/api/lots/L02/descendants");
    assert.equal(resUnrelated.status, 403);
    assert.match(resUnrelated.body.message, /bị từ chối/i);
  });
});
