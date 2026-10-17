const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryRecallOrders,
  seedS39InMemory,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Story S-38 (N2-105): Lô đang trong lệnh thu hồi bị chặn bàn giao, tách và gộp", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Cài đặt tài khoản test
  users.set("inspector_s38@agri.gov.vn", {
    id: "usr-insp-s38",
    email: "inspector_s38@agri.gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-INSP",
    roleId: "inspector",
  });

  users.set("producer_s38@org-a.vn", {
    id: "usr-prod-s38",
    email: "producer_s38@org-a.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "producer",
  });

  users.set("processor_s38@org-b.vn", {
    id: "usr-proc-s38",
    email: "processor_s38@org-b.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-B",
    roleId: "cooperative",
  });

  users.set("distributor_s38@org-c.vn", {
    id: "usr-dist-s38",
    email: "distributor_s38@org-c.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-C",
    roleId: "distributor",
  });

  users.set("admin_s38@system.vn", {
    id: "usr-admin-s38",
    email: "admin_s38@system.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  // Nạp dữ liệu phả hệ mẫu S-39 (15 lô R01..R15)
  seedS39InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
  });

  let inspectorAgent;
  let producerAgent;
  let processorAgent;
  let distributorAgent;

  t.beforeEach(async () => {
    inspectorAgent = await loginAs("inspector_s38@agri.gov.vn");
    producerAgent = await loginAs("producer_s38@org-a.vn");
    processorAgent = await loginAs("processor_s38@org-b.vn");
    distributorAgent = await loginAs("distributor_s38@org-c.vn");
  });

  await t.test("Tiền đề 1: Thao tác bình thường khi lô KHÔNG nằm trong lệnh thu hồi", async () => {
    // Lô đối chứng độc lập R15 (Tồn 100 kg, thuộc ORG-C) không bị thu hồi
    const splitRes = await distributorAgent.post("/api/lots/R15/split").send({
      splits: [
        { name: "Lô con R15-A", quantity: 20 },
        { name: "Lô con R15-B", quantity: 30 },
      ],
    });
    assert.equal(splitRes.status, 201, "Tách lô thành công khi lô không bị thu hồi");
  });

  let openRecallOrderId = null;

  await t.test("Bước 1: Cán bộ kiểm tra mở lệnh thu hồi đang mở (OPEN) cho lô gốc R01", async () => {
    const res = await inspectorAgent.post("/api/recalls").send({
      lotId: "R01",
      reason: "Phát hiện dư lượng thuốc BVTV vượt ngưỡng quy định",
      severity: "HIGH",
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.recallOrder);
    assert.equal(res.body.recallOrder.status, "OPEN");
    openRecallOrderId = res.body.recallOrder.id;

    // Lô gốc R01 tự động chuyển sang trạng thái 'Có sự cố'
    const r01Lot = inMemoryLots.find((l) => l.id === "R01");
    assert.equal(r01Lot.status, "Có sự cố");
  });

  // =========================================================================
  // AC1: Giả sử lô nằm trong lệnh thu hồi đang mở -> BỊ CHẶN KÈM MÃ LỆNH THU HỒI
  // =========================================================================

  await t.test("AC1.1: Chặn bàn giao (Transfer) trên lô gốc R01 đang trong lệnh thu hồi mở", async () => {
    const res = await producerAgent.post("/api/lots/R01/transfers").send({
      toOrganizationId: "ORG-B",
      notes: "Cố tình bàn giao lô đang bị thu hồi",
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(res.body.recallOrderId, openRecallOrderId, "Phải trả về đúng mã lệnh thu hồi đang mở");
    assert.match(res.body.message, new RegExp(openRecallOrderId));
  });

  await t.test("AC1.2: Chặn tách (Split) trên lô gốc R01 đang trong lệnh thu hồi mở", async () => {
    const res = await producerAgent.post("/api/lots/R01/split").send({
      splits: [{ name: "Lô con tách từ R01", quantity: 50 }],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(res.body.recallOrderId, openRecallOrderId, "Phải trả về mã lệnh thu hồi kèm theo");
    assert.match(res.body.message, new RegExp(openRecallOrderId));
  });

  await t.test("AC1.3: Chặn gộp (Merge) khi danh sách lô gộp chứa lô R01 đang thu hồi", async () => {
    // Gộp R01 và R02
    const res = await producerAgent.post("/api/lots/merge").send({
      name: "Lô gộp chứa R01 bị thu hồi",
      items: [
        { parent_batch_id: "R01", take_quantity: 10 },
        { parent_batch_id: "R02", take_quantity: 10 },
      ],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(res.body.recallOrderId, openRecallOrderId);
    assert.equal(res.body.lotId, "R01");
  });

  await t.test("AC1.4: Chặn bàn giao, tách, gộp trên LÔ HẬU DUỆ (R04 thuộc diện thu hồi của R01)", async () => {
    // Theo S-39, R04 là lô con của R01 thuộc ORG-B (Tồn 150 kg)
    // 1. Chặn bàn giao R04
    const trfRes = await processorAgent.post("/api/lots/R04/transfers").send({
      toOrganizationId: "ORG-C",
      notes: "Bàn giao lô hậu duệ R04",
    });
    assert.equal(trfRes.status, 400);
    assert.equal(trfRes.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(trfRes.body.recallOrderId, openRecallOrderId);

    // 2. Chặn tách R04
    const splitRes = await processorAgent.post("/api/lots/R04/split").send({
      splits: [{ name: "Tách từ hậu duệ R04", quantity: 20 }],
    });
    assert.equal(splitRes.status, 400);
    assert.equal(splitRes.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(splitRes.body.recallOrderId, openRecallOrderId);

    // 3. Chặn gộp R04 với R05 (cả 2 đều thuộc ORG-B)
    const mergeRes = await processorAgent.post("/api/lots/merge").send({
      name: "Gộp R04 và R05",
      items: [
        { parent_batch_id: "R04", take_quantity: 20 },
        { parent_batch_id: "R05", take_quantity: 20 },
      ],
    });
    assert.equal(mergeRes.status, 400);
    assert.equal(mergeRes.body.error, "LOT_IN_ACTIVE_RECALL");
    assert.equal(mergeRes.body.recallOrderId, openRecallOrderId);
  });

  // =========================================================================
  // AC2: Giả sử lệnh đã HOÀN TẤT -> VẪN BỊ CHẶN vì lô đã được đánh dấu có sự cố
  // =========================================================================

  await t.test("AC2.1: Chuyển lệnh thu hồi sang COMPLETED (Hoàn tất) -> Vẫn bị chặn khi bàn giao", async () => {
    // Cập nhật trạng thái lệnh thu hồi thành COMPLETED
    const order = inMemoryRecallOrders.find((o) => o.id === openRecallOrderId);
    assert.ok(order);
    order.status = "COMPLETED";

    // Cố gắng bàn giao lô R01 (đã đánh dấu 'Có sự cố')
    const res = await producerAgent.post("/api/lots/R01/transfers").send({
      toOrganizationId: "ORG-B",
      notes: "Bàn giao sau khi lệnh thu hồi đã đóng",
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_RECALLED_OR_INCIDENT");
    assert.match(res.body.message, /đã được đánh dấu có sự cố/);
  });

  await t.test("AC2.2: Lệnh đã hoàn tất -> Vẫn bị chặn khi tách lô", async () => {
    const res = await producerAgent.post("/api/lots/R01/split").send({
      splits: [{ name: "Tách sau khi lệnh hoàn tất", quantity: 20 }],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_RECALLED_OR_INCIDENT");
    assert.match(res.body.message, /đã được đánh dấu có sự cố/);
  });

  await t.test("AC2.3: Lệnh đã hoàn tất -> Vẫn bị chặn khi gộp lô", async () => {
    const res = await producerAgent.post("/api/lots/merge").send({
      name: "Gộp sau khi lệnh hoàn tất",
      items: [
        { parent_batch_id: "R01", take_quantity: 10 },
        { parent_batch_id: "R02", take_quantity: 10 },
      ],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_RECALLED_OR_INCIDENT");
    assert.match(res.body.message, /đã được đánh dấu có sự cố/);
  });

  await t.test("AC2.4: Lô độc lập có status='Có sự cố' hoặc 'Đã thu hồi' (kể cả không có lệnh thu hồi mở) cũng bị chặn", async () => {
    const testProblemLot = "LOT-PROBLEM-ISOLATED";
    inMemoryLots.push({
      id: testProblemLot,
      name: "Lô có sự cố độc lập",
      status: "Có sự cố",
      organizationId: "ORG-A",
      farmId: null,
      productId: "PROD-TOMATO",
      initialQuantity: 100,
      remainingQuantity: 100,
      harvestedAt: "2026-10-10",
      parentLotId: null,
      createdAt: new Date().toISOString(),
    });

    // 1. Thử bàn giao
    const trfRes = await producerAgent.post(`/api/lots/${testProblemLot}/transfers`).send({
      toOrganizationId: "ORG-B",
    });
    assert.equal(trfRes.status, 400);
    assert.equal(trfRes.body.error, "LOT_RECALLED_OR_INCIDENT");

    // 2. Thử tách
    const splitRes = await producerAgent.post(`/api/lots/${testProblemLot}/split`).send({
      splits: [{ name: "Tách lô lỗi", quantity: 10 }],
    });
    assert.equal(splitRes.status, 400);
    assert.equal(splitRes.body.error, "LOT_RECALLED_OR_INCIDENT");

    // 3. Thử gộp
    const mergeRes = await producerAgent.post("/api/lots/merge").send({
      name: "Gộp lô lỗi",
      items: [
        { parent_batch_id: testProblemLot, take_quantity: 10 },
        { parent_batch_id: "R02", take_quantity: 10 },
      ],
    });
    assert.equal(mergeRes.status, 400);
    assert.equal(mergeRes.body.error, "LOT_RECALLED_OR_INCIDENT");
  });
});
