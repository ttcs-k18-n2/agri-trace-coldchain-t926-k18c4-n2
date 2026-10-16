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
  seedS39Data,
  verifyBatchEventChain,
} = require("../src/server");

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

test("S-34 (Subtasks 2 & 5): Kiểm chứng 3 AC & NFR Thu hồi liệt kê đủ mọi lô hậu duệ kể cả lô gộp đa nguồn", async (t) => {
  // Cài đặt tài khoản người dùng
  const passwordHash = await hashPassword("Password123!");

  users.set("inspector_s34@agri.gov.vn", {
    id: "usr-insp-s34",
    email: "inspector_s34@agri.gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("admin_s34@agri.vn", {
    id: "usr-admin-s34",
    email: "admin_s34@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  users.set("producer_s34@agri.vn", {
    id: "usr-producer-s34",
    email: "producer_s34@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "producer",
  });

  // Nạp seed S-39
  seedS39Data();

  const inspectorAgent = await loginAs("inspector_s34@agri.gov.vn");
  const producerAgent = await loginAs("producer_s34@agri.vn");

  let createdRecallId = null;

  await t.test("Test Case 1 (AC1 - Khớp 100% đáp án đếm tay S-39): Mở lệnh thu hồi R01, kiểm chứng đủ 7 hậu duệ, tồn kho 730kg, R11 bán hết", async () => {
    // 1. Mở lệnh thu hồi cho lô gốc R01
    const postRes = await inspectorAgent.post("/api/recalls").send({
      lotId: "R01",
      reason: "Phát hiện dư lượng thuốc BVTV vượt ngưỡng quy định",
      severity: "HIGH",
    });

    assert.equal(postRes.status, 201, `Mở lệnh thu hồi thất bại: ${JSON.stringify(postRes.body)}`);
    assert.ok(postRes.body.recallOrder);
    assert.equal(postRes.body.recallOrder.lotId, "R01");
    assert.equal(postRes.body.recallOrder.severity, "HIGH");
    assert.equal(postRes.body.recallOrder.status, "OPEN");

    createdRecallId = postRes.body.recallOrder.id;

    // Kiểm tra lô gốc R01 được chuyển trạng thái 'Có sự cố'
    const r01Lot = inMemoryLots.find((l) => l.id === "R01");
    assert.equal(r01Lot.status, "Có sự cố");

    // 2. Gọi GET /api/recalls/:id/descendants
    const descRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
    assert.equal(descRes.status, 200);

    const body = descRes.body;
    assert.equal(body.recallId, createdRecallId);
    assert.equal(body.rootLotId, "R01");

    // Kiểm chứng danh sách hậu duệ trả về đủ 7 lô: {R04, R05, R08, R09, R11, R12, R13}
    const expectedDescendants = new Set(["R04", "R05", "R08", "R09", "R11", "R12", "R13"]);
    assert.equal(body.descendantCount, 7, "Tổng số lô hậu duệ là 7");
    assert.equal(
      eqSet(new Set(body.descendantIds), expectedDescendants),
      true,
      `Kỳ vọng: ${[...expectedDescendants]}, thực tế: ${body.descendantIds}`
    );

    // Tổng khối lượng thu hồi chính xác 730.000 kg (150+100+100+100+200+80)
    assert.equal(body.totalRecallQuantity, 730);

    // Lô R11 có trạng thái "Đã bán hết" và khối lượng tồn bằng 0
    const r11InDesc = body.descendants.find((d) => d.id === "R11");
    assert.ok(r11InDesc, "R11 phải có trong danh sách hậu duệ");
    assert.equal(r11InDesc.status, "Đã bán hết");
    assert.equal(r11InDesc.remainingQuantity, 0);

    // Kiểm tra consumedLots chứa R11
    assert.ok(Array.isArray(body.consumedLots));
    assert.equal(body.consumedLots.length, 1);
    assert.equal(body.consumedLots[0].id, "R11");
  });

  await t.test("Test Case 2 (AC2 - Nhận diện lô gộp từ nhiều nguồn): R08 có isMultiSourceMerge = true và ghi nhận 2 nguồn", async () => {
    const descRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
    assert.equal(descRes.status, 200);

    const r08 = descRes.body.descendants.find((d) => d.id === "R08");
    assert.ok(r08, "Lô R08 phải có trong danh sách");
    assert.equal(r08.isMultiSourceMerge, true, "R08 phải có cờ isMultiSourceMerge = true");
    assert.equal(r08.sourcesCount, 2, "R08 có 2 nguồn cha");
    assert.equal(r08.notes, "Lô gộp từ nhiều nguồn");
    assert.ok(Array.isArray(r08.mergedSources));
    assert.equal(r08.mergedSources.length, 2);

    const parentSources = r08.mergedSources.map((s) => s.parentBatchId);
    assert.ok(parentSources.includes("R04"), "Nguồn 1 là R04");
    assert.ok(parentSources.includes("R06"), "Nguồn 2 là R06");

    // Mở thêm 1 lệnh cho R03 để kiểm tra R10 (gộp từ R06 và R07)
    const recR03 = await inspectorAgent.post("/api/recalls").send({
      lotId: "R03",
      reason: "Kiểm tra lô gộp đa nguồn R10",
      severity: "MEDIUM",
    });
    assert.equal(recR03.status, 201);
    const descR03 = await inspectorAgent.get(`/api/recalls/${recR03.body.recallOrder.id}/descendants`);
    assert.equal(descR03.status, 200);
    const r10 = descR03.body.descendants.find((d) => d.id === "R10");
    assert.ok(r10, "R10 phải nằm trong hậu duệ của R03");
    assert.equal(r10.isMultiSourceMerge, true);
    assert.equal(r10.sourcesCount, 2);
    const r10Parents = r10.mergedSources.map((s) => s.parentBatchId);
    assert.ok(r10Parents.includes("R06"));
    assert.ok(r10Parents.includes("R07"));
  });

  await t.test("Test Case 3 (AC3 & NFR - Tách lô mới sau khi đã mở lệnh & tính lại động): Hậu duệ tự động tăng từ 7 lên 8", async () => {
    // Bước 1: Kiểm tra trước khi tách thêm lô -> số hậu duệ = 7
    const beforeRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
    assert.equal(beforeRes.body.descendantCount, 7);

    // Bước 2: Giả lập tách thêm lô mới R16 từ lô cháu R12 (thực hiện qua quan hệ SPLIT)
    inMemoryLots.push({
      id: "R16",
      name: "Lô Cà chua Tách Mới R16 (Tách từ R12)",
      status: "Đang lưu kho",
      organizationId: "ORG-C",
      farmId: null,
      productId: "PROD-TOMATO",
      initialQuantity: 50.0,
      remainingQuantity: 50.0,
      harvestedAt: "2026-10-06",
      parentLotId: "R12",
      createdAt: new Date().toISOString(),
    });

    inMemoryBatchRelations.push({
      id: "rel-s34-test-r16",
      parentBatchId: "R12",
      childBatchId: "R16",
      relationType: "SPLIT",
      quantity: 50.0,
      organizationId: "ORG-C",
    });

    // Giảm tồn kho R12 tương ứng: 200 -> 150
    const r12Lot = inMemoryLots.find((l) => l.id === "R12");
    r12Lot.remainingQuantity = 150.0;

    // Bước 3: Gọi lại API GET /api/recalls/:id/descendants
    const afterRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
    assert.equal(afterRes.status, 200);

    // Bước 4: Kiểm chứng số hậu duệ tự động tăng lên 8, có chứa R16 mà không cần sửa lệnh thu hồi
    assert.equal(afterRes.body.descendantCount, 8, "Số hậu duệ tự động tăng lên 8");
    assert.ok(afterRes.body.descendantIds.includes("R16"), "Danh sách hậu duệ chứa lô mới R16");

    const r16InDesc = afterRes.body.descendants.find((d) => d.id === "R16");
    assert.ok(r16InDesc);
    assert.equal(r16InDesc.remainingQuantity, 50.0);
    assert.equal(r16InDesc.parentLotId, "R12");

    // Tổng khối lượng thu hồi vẫn bảo toàn: (150+100+100+100+150+50+80) = 730kg
    assert.equal(afterRes.body.totalRecallQuantity, 730);

    // Dọn dẹp lô R16 khỏi inMemoryLots và inMemoryBatchRelations
    const idxR16 = inMemoryLots.findIndex((l) => l.id === "R16");
    if (idxR16 >= 0) inMemoryLots.splice(idxR16, 1);
    const idxRel = inMemoryBatchRelations.findIndex((r) => r.id === "rel-s34-test-r16");
    if (idxRel >= 0) inMemoryBatchRelations.splice(idxRel, 1);
    r12Lot.remainingQuantity = 200.0;
  });

  await t.test("Test Case 4 (Ràng buộc toàn vẹn & Phân quyền): Chặn khi lô không tồn tại, kiểm tra SHA-256, và chặn role Producer", async () => {
    // 1. Không thể mở lệnh thu hồi nếu mã lô không tồn tại
    const notFoundRes = await inspectorAgent.post("/api/recalls").send({
      lotId: "LOT-NON-EXISTENT",
      reason: "Kiểm tra mã lô không tồn tại",
      severity: "HIGH",
    });
    assert.equal(notFoundRes.status, 404);
    assert.equal(notFoundRes.body.error, "LOT_NOT_FOUND");

    // 2. Chặn vai trò không phải Inspector hoặc Admin (RBAC: Producer bị chặn 403)
    const forbiddenRes = await producerAgent.post("/api/recalls").send({
      lotId: "R01",
      reason: "Producer tự mở lệnh thu hồi",
      severity: "HIGH",
    });
    assert.equal(forbiddenRes.status, 403);

    const forbiddenGetRes = await producerAgent.get(`/api/recalls/${createdRecallId}`);
    assert.equal(forbiddenGetRes.status, 403);

    const forbiddenDescRes = await producerAgent.get(`/api/recalls/${createdRecallId}/descendants`);
    assert.equal(forbiddenDescRes.status, 403);

    // 3. Kiểm tra tính hợp lệ của chuỗi băm sự kiện SHA-256 sau khi mở lệnh (K-01 / S-10)
    const r01Events = inMemoryBatchEvents.filter((e) => (e.batchId || e.batch_id) === "R01");
    assert.ok(r01Events.length > 0);

    const recallEvent = r01Events.find((e) => (e.eventType || e.event_type) === "RECALL_ORDER_CREATED");
    assert.ok(recallEvent, "Sự kiện RECALL_ORDER_CREATED phải được lưu vào chuỗi batch_events");
    assert.ok(recallEvent.eventHash || recallEvent.event_hash, "Sự kiện phải có mã băm SHA-256");

    const chainValidation = verifyBatchEventChain(r01Events);
    assert.equal(chainValidation.valid, true, `Chuỗi sự kiện của R01 phải bảo toàn toàn vẹn mật mã: ${chainValidation.error}`);
  });
});
