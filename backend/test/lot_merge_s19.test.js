const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchEvents,
  inMemoryTransfers,
  inMemoryBatchRelations,
  setAppendHookForTesting,
  validateMergeLotInput,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Lot Merge API [S-19] (Tasks T-44, T-45, T-46) & Parent-Child Lineage Integration Test", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Setup test users for distinct roles & organizations
  users.set("dist_merge@org3.vn", {
    id: "usr-dist-merge",
    email: "dist_merge@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-merge-003",
    roleId: "distributor",
  });

  users.set("coop_merge@org2.vn", {
    id: "usr-coop-merge",
    email: "coop_merge@org2.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-merge-002",
    roleId: "cooperative",
  });

  users.set("other_org@org99.vn", {
    id: "usr-other-merge",
    email: "other_org@org99.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-merge-999",
    roleId: "distributor",
  });

  users.set("inspector_merge@gov.vn", {
    id: "usr-insp-merge",
    email: "inspector_merge@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  // Prepare seed lots
  const lotA = "LOT-MERGE-A1";
  const lotB = "LOT-MERGE-B2";
  const lotC = "LOT-MERGE-C3";
  const lotOtherProduct = "LOT-MERGE-DIFF-PROD";
  const lotOtherOrg = "LOT-MERGE-OTHER-ORG";
  const lotPending = "LOT-MERGE-PENDING";

  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (inMemoryLots[i].id.startsWith("LOT-MERGE-")) {
      inMemoryLots.splice(i, 1);
    }
  }

  inMemoryLots.push({
    id: lotA,
    name: "Lô Dưa lưới Chuẩn VietGAP - Kho A",
    status: "Đã thu hoạch",
    organizationId: "org-merge-003",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 300,
    remainingQuantity: 300,
    harvestedAt: "2026-10-06T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: lotB,
    name: "Lô Dưa lưới Chuẩn VietGAP - Kho B",
    status: "Đã thu hoạch",
    organizationId: "org-merge-003",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 200,
    remainingQuantity: 200,
    harvestedAt: "2026-10-06T08:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T08:00:00.000Z",
  });

  inMemoryLots.push({
    id: lotC,
    name: "Lô Dưa lưới Chuẩn VietGAP - Kho C",
    status: "Đã thu hoạch",
    organizationId: "org-merge-003",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 150,
    remainingQuantity: 150,
    harvestedAt: "2026-10-06T09:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T09:00:00.000Z",
  });

  inMemoryLots.push({
    id: lotOtherProduct,
    name: "Lô Cà chua Bi VietGAP (Khác sản phẩm)",
    status: "Đã thu hoạch",
    organizationId: "org-merge-003",
    farmId: "FARM-001",
    productId: "PROD-TOMATO",
    initialQuantity: 100,
    remainingQuantity: 100,
    harvestedAt: "2026-10-06T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: lotOtherOrg,
    name: "Lô Dưa lưới thuộc Tổ chức Khác",
    status: "Đã thu hoạch",
    organizationId: "org-merge-999",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 400,
    remainingQuantity: 400,
    harvestedAt: "2026-10-06T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: lotPending,
    name: "Lô Dưa lưới Đang Chờ Bàn Giao",
    status: "Đã thu hoạch",
    organizationId: "org-merge-003",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 120,
    remainingQuantity: 120,
    harvestedAt: "2026-10-06T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-06T07:00:00.000Z",
  });

  inMemoryTransfers.push({
    id: "TR-MERGE-PENDING-01",
    lotId: lotPending,
    fromOrganizationId: "org-merge-003",
    toOrganizationId: "org-merge-002",
    status: "PENDING",
    notes: "Chờ xác nhận bàn giao",
    createdAt: new Date().toISOString(),
  });

  // Task T-45: Unit Validator Function Tests
  await t.test("1. Task T-45 Validator: rejects < 2 items or invalid structure", () => {
    const res1 = validateMergeLotInput([], [], "org-merge-003");
    assert.equal(res1.isValid, false);
    assert.equal(res1.error, "INVALID_MERGE_INPUT");

    const res2 = validateMergeLotInput([{ parent_batch_id: lotA, take_quantity: 100 }], [], "org-merge-003");
    assert.equal(res2.isValid, false);
    assert.equal(res2.error, "INVALID_MERGE_INPUT");
  });

  await t.test("2. Task T-45 AC1: Chặn và ném lỗi rõ ràng khi gộp các lô khác sản phẩm", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");
    const res = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: 100 },
        { parent_batch_id: lotOtherProduct, take_quantity: 50 },
      ],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "DIFFERENT_PRODUCTS");
    assert.match(
      res.body.message,
      new RegExp(`Không thể gộp các lô khác sản phẩm: \\[${lotOtherProduct}\\]`)
    );
  });

  await t.test("3. Task T-45 AC2: Chặn và chỉ rõ lỗi khi lô hàng không thuộc quyền quản lý của tổ chức", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");
    const res = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: 100 },
        { parent_batch_id: lotOtherOrg, take_quantity: 100 },
      ],
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, "FORBIDDEN_ORG");
    assert.match(
      res.body.message,
      new RegExp(`Lô hàng không thuộc quyền quản lý của tổ chức: \\[${lotOtherOrg}\\]`)
    );
  });

  await t.test("4. Task T-45 AC3: Chặn khi khối lượng lấy <= 0 hoặc vượt quá remaining_quantity", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");

    // Lỗi khối lượng <= 0
    const resZero = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: -10 },
        { parent_batch_id: lotB, take_quantity: 50 },
      ],
    });
    assert.equal(resZero.status, 400);
    assert.equal(resZero.body.error, "INVALID_QUANTITY");
    assert.match(resZero.body.message, new RegExp(`\\[${lotA}\\]`));

    // Lỗi khối lượng vượt quá remaining_quantity (lotA có 300, lấy 350)
    const resExceed = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: 350 },
        { parent_batch_id: lotB, take_quantity: 50 },
      ],
    });
    assert.equal(resExceed.status, 400);
    assert.equal(resExceed.body.error, "EXCEEDS_REMAINING_QUANTITY");
    assert.match(resExceed.body.message, new RegExp(`\\[${lotA}\\]`));
  });

  await t.test("5. Task T-45 Pre-condition: Chặn gộp lô đang có chuyển giao PENDING", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");
    const res = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: 50 },
        { parent_batch_id: lotPending, take_quantity: 50 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "PENDING_TRANSFER_EXISTS");
    assert.match(res.body.message, new RegExp(`\\[${lotPending}\\]`));
  });

  let createdPartialMergedLotId = null;

  await t.test("6. Task T-44 AC2: Gộp một phần (Partial Merge) thành công, trừ đúng khối lượng và tạo batch_relations", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");

    // lotA remaining = 300, lấy 120 -> còn 180
    // lotB remaining = 200, lấy 80 -> còn 120
    // Lô mới có initialQuantity = remainingQuantity = 200
    const res = await distAgent.post("/api/lots/merge").send({
      name: "Lô Dưa lưới Gộp Phân Phối Siêu Thị A",
      items: [
        { parent_batch_id: lotA, take_quantity: 120 },
        { parent_batch_id: lotB, take_quantity: 80 },
      ],
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.lot);
    assert.equal(res.body.lot.name, "Lô Dưa lưới Gộp Phân Phối Siêu Thị A");
    assert.equal(res.body.lot.initialQuantity, 200);
    assert.equal(res.body.lot.remainingQuantity, 200);
    assert.equal(res.body.lot.productId, "PROD-MELON");
    assert.equal(res.body.lot.organizationId, "org-merge-003");

    createdPartialMergedLotId = res.body.lot.id;

    // Kiểm tra số dư các lô mẹ
    const lotAObj = inMemoryLots.find((l) => l.id === lotA);
    const lotBObj = inMemoryLots.find((l) => l.id === lotB);
    assert.equal(lotAObj.remainingQuantity, 180);
    assert.equal(lotBObj.remainingQuantity, 120);

    // Kiểm tra batch_relations ('MERGE') (Task T-44 AC3)
    const relA = inMemoryBatchRelations.find(
      (r) => r.parentBatchId === lotA && r.childBatchId === createdPartialMergedLotId
    );
    assert.ok(relA, "Relation for parent A must exist");
    assert.equal(relA.relationType, "MERGE");
    assert.equal(relA.quantity, 120);

    const relB = inMemoryBatchRelations.find(
      (r) => r.parentBatchId === lotB && r.childBatchId === createdPartialMergedLotId
    );
    assert.ok(relB, "Relation for parent B must exist");
    assert.equal(relB.relationType, "MERGE");
    assert.equal(relB.quantity, 80);

    // Kiểm tra Batch Events bảo chứng SHA-256
    const mergeEvent = inMemoryBatchEvents.find(
      (e) => e.batchId === createdPartialMergedLotId && e.eventType === "CREATED_FROM_MERGE"
    );
    assert.ok(mergeEvent, "CREATED_FROM_MERGE event must be logged");
    assert.equal(mergeEvent.payload.totalQuantity, 200);
  });

  await t.test("7. Task T-44 AC1: Gộp toàn bộ (Full Merge) giảm số lượng còn lại của từng lô mẹ về 0", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");

    // Lấy hết số lượng còn lại:
    // lotA còn 180 -> lấy 180 -> còn 0
    // lotC có 150 -> lấy 150 -> còn 0
    // Tổng lô mới = 330
    const res = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotA, take_quantity: 180 },
        { parent_batch_id: lotC, take_quantity: 150 },
      ],
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.lot.initialQuantity, 330);
    assert.equal(res.body.lot.remainingQuantity, 330);

    const lotAObj = inMemoryLots.find((l) => l.id === lotA);
    const lotCObj = inMemoryLots.find((l) => l.id === lotC);
    assert.equal(lotAObj.remainingQuantity, 0, "Lot A remaining must be reduced to 0");
    assert.equal(lotCObj.remainingQuantity, 0, "Lot C remaining must be reduced to 0");
  });

  await t.test("8. Task T-44 AC4: Atomicity & Rollback when an error occurs during merge processing", async () => {
    const distAgent = await loginAs("dist_merge@org3.vn");

    // lotB đang còn 120. Lấy 40 từ lotB và 0 từ lotA (sẽ thất bại) hoặc throw error via hook
    const lotBObj = inMemoryLots.find((l) => l.id === lotB);
    const initialBRem = lotBObj.remainingQuantity;
    const initialLotsCount = inMemoryLots.length;
    const initialRelationsCount = inMemoryBatchRelations.length;
    const initialEventsCount = inMemoryBatchEvents.length;

    // Simulate failure during batch event append
    setAppendHookForTesting((eventData) => {
      if (eventData.eventType === "CREATED_FROM_MERGE") {
        throw new Error("Simulated failure during CREATED_FROM_MERGE event append (T-44 Rollback)");
      }
    });

    try {
      const res = await distAgent.post("/api/lots/merge").send({
        items: [
          { parent_batch_id: lotB, take_quantity: 40 },
          { parent_batch_id: lotA, take_quantity: 0.1 }, // lotA còn 0 -> sẽ bị validate chặn trước nếu không còn
        ],
      });

      // Ở đây lotA đã hết, nên ta test với 2 lô còn số dư: lotB (120) và tạo 1 lô giả lập
      // Tạo thêm 1 lô mới còn dư
      const tempLot = "LOT-MERGE-TEMP-ROLLBACK";
      inMemoryLots.push({
        id: tempLot,
        name: "Lô Rollback Test",
        status: "Đã thu hoạch",
        organizationId: "org-merge-003",
        farmId: "FARM-001",
        productId: "PROD-MELON",
        initialQuantity: 100,
        remainingQuantity: 100,
        harvestedAt: "2026-10-06T07:00:00.000Z",
        parentLotId: null,
        createdAt: "2026-10-06T07:00:00.000Z",
      });

      const resRollback = await distAgent.post("/api/lots/merge").send({
        items: [
          { parent_batch_id: lotB, take_quantity: 30 },
          { parent_batch_id: tempLot, take_quantity: 30 },
        ],
      });

      assert.equal(resRollback.status, 500);
      assert.match(resRollback.body.message, /Simulated failure during CREATED_FROM_MERGE/);

      // Verify rollback: lotB quantity must be restored
      assert.equal(lotBObj.remainingQuantity, initialBRem, "Lot B remaining quantity must be rolled back");
      const tempObj = inMemoryLots.find((l) => l.id === tempLot);
      assert.equal(tempObj.remainingQuantity, 100, "Temp lot remaining quantity must be rolled back");

      // Verify no new relations persisted
      assert.equal(
        inMemoryBatchRelations.some((r) => r.parentBatchId === tempLot),
        false,
        "Relations must be completely rolled back"
      );
    } finally {
      setAppendHookForTesting(null);
    }
  });

  await t.test("9. Task T-44 NFR Deadlock Prevention: Orders parent batch IDs ascending regardless of payload order", async () => {
    // Gửi payload thứ tự ngược [lotC, lotB]
    // Hệ thống phải xử lý đúng mà không gây lỗi hoặc deadlock
    const distAgent = await loginAs("dist_merge@org3.vn");

    // Chuẩn bị 2 lô tươi mới
    const lotZ = "LOT-MERGE-ORDER-Z";
    const lotM = "LOT-MERGE-ORDER-M";

    inMemoryLots.push({
      id: lotZ,
      name: "Lô Z (ID lớn)",
      status: "Đã thu hoạch",
      organizationId: "org-merge-003",
      farmId: "FARM-001",
      productId: "PROD-MELON",
      initialQuantity: 100,
      remainingQuantity: 100,
      harvestedAt: "2026-10-06T07:00:00.000Z",
      parentLotId: null,
      createdAt: "2026-10-06T07:00:00.000Z",
    });

    inMemoryLots.push({
      id: lotM,
      name: "Lô M (ID nhỏ hơn)",
      status: "Đã thu hoạch",
      organizationId: "org-merge-003",
      farmId: "FARM-001",
      productId: "PROD-MELON",
      initialQuantity: 100,
      remainingQuantity: 100,
      harvestedAt: "2026-10-06T07:00:00.000Z",
      parentLotId: null,
      createdAt: "2026-10-06T07:00:00.000Z",
    });

    const res = await distAgent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotZ, take_quantity: 20 },
        { parent_batch_id: lotM, take_quantity: 20 },
      ],
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.lot.initialQuantity, 40);
  });
});
