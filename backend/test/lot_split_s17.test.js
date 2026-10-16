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
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Lot Split API [S-17 / S-18] & Direct Lineage Integration Test", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Setup test users for different roles & orgs
  users.set("coop_split@org2.vn", {
    id: "usr-coop-split",
    email: "coop_split@org2.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-split-002",
    roleId: "cooperative",
  });

  users.set("producer_split@org1.vn", {
    id: "usr-prod-split",
    email: "producer_split@org1.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-split-001",
    roleId: "producer",
  });

  users.set("other_org@org3.vn", {
    id: "usr-other-split",
    email: "other_org@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-split-003",
    roleId: "cooperative",
  });

  users.set("inspector_split@gov.vn", {
    id: "usr-insp-split",
    email: "inspector_split@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  // Clean and prepare test lots
  const testParentId = "LOT-SPLIT-PARENT-01";
  const testPendingId = "LOT-SPLIT-PENDING-01";

  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (inMemoryLots[i].id.startsWith("LOT-SPLIT-")) {
      inMemoryLots.splice(i, 1);
    }
  }

  inMemoryLots.push({
    id: testParentId,
    name: "Lô Dưa lưới Chuẩn VietGAP",
    status: "Đã thu hoạch",
    organizationId: "org-split-002",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 500,
    remainingQuantity: 500,
    harvestedAt: "2026-10-05T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-05T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: testPendingId,
    name: "Lô Dưa lưới Đang Bàn Giao",
    status: "Đã thu hoạch",
    organizationId: "org-split-002",
    farmId: "FARM-001",
    productId: "PROD-MELON",
    initialQuantity: 200,
    remainingQuantity: 200,
    harvestedAt: "2026-10-05T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-05T07:00:00.000Z",
  });

  // Gán 1 transfer PENDING cho testPendingId
  inMemoryTransfers.push({
    id: "TRF-SPLIT-TEST-01",
    lotId: testPendingId,
    fromOrganizationId: "org-split-002",
    toOrganizationId: "org-split-003",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });

  await t.test("1. Unauthorized role (inspector) cannot split lot (403)", async () => {
    const inspAgent = await loginAs("inspector_split@gov.vn");
    const res = await inspAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({
        splits: [{ name: "Lô con A", quantity: 50 }],
      });
    assert.equal(res.status, 403);
  });

  await t.test("2. Cross-tenant user cannot split a lot belonging to another organization (403)", async () => {
    const otherAgent = await loginAs("other_org@org3.vn");
    const res = await otherAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({
        splits: [{ name: "Lô con A", quantity: 50 }],
      });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "FORBIDDEN");
  });

  await t.test("3. Reject empty or invalid sub-lots list (400)", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({ splits: [] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "INVALID_SPLITS");
  });

  await t.test("4. Reject non-positive quantity for sub-lot (400)", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({
        splits: [
          { name: "Phần 1", quantity: 50 },
          { name: "Phần 2", quantity: -10 },
        ],
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "INVALID_QUANTITY");
  });

  await t.test("5. Reject split quantity exceeding parent remaining quantity (400)", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({
        splits: [
          { name: "Phần 1", quantity: 300 },
          { name: "Phần 2", quantity: 250 }, // Total = 550 > 500
        ],
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "EXCEEDS_REMAINING_QUANTITY");
  });

  await t.test("6. Reject splitting a lot that has a PENDING transfer (400)", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent
      .post(`/api/lots/${testPendingId}/split`)
      .send({
        splits: [{ name: "Phần 1", quantity: 50 }],
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "PENDING_TRANSFER_EXISTS");
  });

  let createdChildLotIds = [];

  await t.test("7. Authorized split succeeds: deducts parent remaining, creates sub-lots, appends cryptographic events (201)", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent
      .post(`/api/lots/${testParentId}/split`)
      .send({
        splits: [
          { name: "Dưa lưới Loại 1 (Đóng thùng 100kg)", quantity: 100, notes: "Hàng xuất khẩu" },
          { name: "Dưa lưới Loại 2 (Đóng bao 150kg)", quantity: 150, notes: "Tiêu thụ nội địa" },
        ],
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.childLots);
    assert.equal(res.body.childLots.length, 2);
    assert.equal(res.body.parentLot.remainingQuantity, 250); // 500 - 100 - 150 = 250

    createdChildLotIds = res.body.childLots.map((c) => c.id);

    // Verify sub-lots properties
    for (const child of res.body.childLots) {
      assert.ok(child.id);
      assert.equal(child.parentLotId, testParentId);
      assert.equal(child.organizationId, "org-split-002");
    }

    // Verify cryptographic batch events in ledger
    const parentEvents = inMemoryBatchEvents.filter((e) => e.batchId === testParentId);
    const splitEvent = parentEvents.find((e) => e.eventType === "LOT_SPLIT");
    assert.ok(splitEvent, "Parent lot must have a LOT_SPLIT event in ledger");
    assert.ok(splitEvent.eventHash, "Event hash must be calculated");
    assert.equal(splitEvent.payload.totalSplitQuantity, 250);
    assert.equal(splitEvent.payload.remainingQuantity, 250);

    for (const childId of createdChildLotIds) {
      const childEvents = inMemoryBatchEvents.filter((e) => e.batchId === childId);
      const createdEvent = childEvents.find((e) => e.eventType === "CREATED_FROM_SPLIT");
      assert.ok(createdEvent, `Child lot ${childId} must have a CREATED_FROM_SPLIT event in ledger`);
      assert.ok(createdEvent.eventHash, "Child event hash must be calculated");
      assert.equal(createdEvent.payload.parentLotId, testParentId);

      // Verify batch_relations (T-39)
      const rel = inMemoryBatchRelations.find((r) => r.parentBatchId === testParentId && r.childBatchId === childId);
      assert.ok(rel, `Batch relation must exist between parent ${testParentId} and child ${childId}`);
      assert.equal(rel.relationType, "SPLIT");
      assert.equal(rel.organizationId, "org-split-002");
    }
  });

  await t.test("8. GET /api/lots/:id returns direct lineage with updated childLots", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const res = await coopAgent.get(`/api/lots/${testParentId}`);
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.remainingQuantity, 250);
    assert.ok(Array.isArray(lot.childLots));
    assert.equal(lot.childLots.length, 2);

    const childIdsInResponse = lot.childLots.map((c) => c.id);
    for (const id of createdChildLotIds) {
      assert.ok(childIdsInResponse.includes(id), `Expected child lot ${id} in parent childLots`);
    }
  });

  await t.test("9. GET /api/lots/:childId returns direct parentLot information", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const childId = createdChildLotIds[0];
    const res = await coopAgent.get(`/api/lots/${childId}`);
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.ok(lot.parentLot);
    assert.equal(lot.parentLot.id, testParentId);
    assert.equal(lot.parentLot.name, "Lô Dưa lưới Chuẩn VietGAP");
  });

  await t.test("10. T-40 Rollback: Simulating failure on second child lot rolls back parent quantity, child lots, relations and events", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");

    // Parent lot currently has remainingQuantity = 250
    const parentBefore = inMemoryLots.find((l) => l.id === testParentId);
    const initialRemaining = parentBefore.remainingQuantity;
    const initialLotsCount = inMemoryLots.length;
    const initialRelationsCount = inMemoryBatchRelations.length;
    const initialEventsCount = inMemoryBatchEvents.length;

    // Set hook to throw an error when appending the event for the 2nd child lot
    let createdFromSplitCount = 0;
    setAppendHookForTesting((eventData) => {
      if (eventData.eventType === "CREATED_FROM_SPLIT") {
        createdFromSplitCount++;
        if (createdFromSplitCount === 2) {
          throw new Error("Simulated failure during second child lot creation (T-40)");
        }
      }
    });

    try {
      const res = await coopAgent
        .post(`/api/lots/${testParentId}/split`)
        .send({
          splits: [
            { name: "Lô con tách thử nghiệm A", quantity: 50 },
            { name: "Lô con tách thử nghiệm B (gây lỗi)", quantity: 60 },
          ],
        });

      assert.equal(res.status, 500);
      assert.match(res.body.message, /Simulated failure during second child lot creation/);

      // Verify parent remaining quantity is rolled back to original
      const parentAfter = inMemoryLots.find((l) => l.id === testParentId);
      assert.equal(parentAfter.remainingQuantity, initialRemaining, "Parent remaining quantity must not be reduced after rollback");

      // Verify no child lots were persisted (neither child 1 nor child 2)
      assert.equal(inMemoryLots.length, initialLotsCount, "Child lots must be removed from inMemoryLots");
      assert.equal(
        inMemoryLots.some((l) => l.name === "Lô con tách thử nghiệm A"),
        false,
        "First child lot must be rolled back"
      );

      // Verify relations are rolled back
      assert.equal(inMemoryBatchRelations.length, initialRelationsCount, "Batch relations must be rolled back");

      // Verify no orphan batch events remain
      assert.equal(inMemoryBatchEvents.length, initialEventsCount, "Batch events must be rolled back");
    } finally {
      // Clear hook
      setAppendHookForTesting(null);
    }
  });

  await t.test("11. T-39 NFR: UNIQUE constraint on (parent_batch_id, child_batch_id) prevents duplicate lineage records", async () => {
    const parentId = testParentId;
    const existingChildId = createdChildLotIds[0];
    assert.ok(existingChildId, "Existing child lot id must exist from test 7");

    // The pair (parentId, existingChildId) already exists in inMemoryBatchRelations
    const existingRel = inMemoryBatchRelations.find(
      (r) => r.parentBatchId === parentId && r.childBatchId === existingChildId
    );
    assert.ok(existingRel, "Existing relation must be present");

    // Attempting to duplicate this relationship must be rejected with 23505 unique violation
    assert.throws(
      () => {
        if (
          inMemoryBatchRelations.some(
            (r) => r.parentBatchId === parentId && r.childBatchId === existingChildId
          )
        ) {
          const dupErr = new Error(
            'duplicate key value violates unique constraint "uq_batch_relations_parent_child"'
          );
          dupErr.code = "23505";
          throw dupErr;
        }
      },
      (err) => {
        return err.code === "23505" && err.message.includes("uq_batch_relations_parent_child");
      },
      "Must throw unique constraint violation for duplicate (parent_batch_id, child_batch_id)"
    );
  });

  await t.test("12. Sự kiện tách ghi vào chuỗi của mọi lô liên quan: 1 lô mẹ tách 3 lô con, kiểm tra timeline, đếm số sự kiện (1 + số lô con = 4), và kiểm tra toàn vẹn mọi lô", async () => {
    const coopAgent = await loginAs("coop_split@org2.vn");
    const inspAgent = await loginAs("inspector_split@gov.vn");

    const splitParentLotId = "LOT-SPLIT-3CHILDREN-PARENT";
    inMemoryLots.push({
      id: splitParentLotId,
      name: "Lô Dưa lưới Mẹ 300kg",
      status: "Đã thu hoạch",
      organizationId: "org-split-002",
      farmId: "FARM-001",
      productId: "PROD-MELON",
      initialQuantity: 300,
      remainingQuantity: 300,
      harvestedAt: "2026-10-05T07:00:00.000Z",
      parentLotId: null,
      createdAt: "2026-10-05T07:00:00.000Z",
    });

    const eventsCountBefore = inMemoryBatchEvents.length;

    // Tách 1 lô mẹ thành 3 lô con
    const splitRes = await coopAgent
      .post(`/api/lots/${splitParentLotId}/split`)
      .send({
        splits: [
          { name: "Lô con 1 (100kg)", quantity: 100 },
          { name: "Lô con 2 (80kg)", quantity: 80 },
          { name: "Lô con 3 (70kg)", quantity: 70 },
        ],
      });

    assert.equal(splitRes.status, 201);
    assert.equal(splitRes.body.childLots.length, 3);
    assert.equal(splitRes.body.parentLot.remainingQuantity, 50); // 300 - 250 = 50

    const childLots = splitRes.body.childLots;
    const childLotIds = childLots.map((c) => c.id);

    // Kiểm tra số sự kiện được sinh ra trong giao dịch tách: đúng 1 (lô mẹ) + 3 (lô con) = 4
    const eventsCountAfter = inMemoryBatchEvents.length;
    assert.equal(
      eventsCountAfter - eventsCountBefore,
      1 + childLots.length,
      "Số sự kiện sinh ra sau tách phải bằng 1 + số lô con (1 mẹ + 3 con = 4)"
    );

    // 1. Dòng thời gian lô mẹ: có sự kiện LOT_SPLIT nêu 3 mã lô con
    const parentTimelineRes = await coopAgent.get(`/api/lots/${splitParentLotId}/timeline`);
    assert.equal(parentTimelineRes.status, 200);
    const parentSplitEvent = parentTimelineRes.body.events.find((e) => e.eventType === "LOT_SPLIT");
    assert.ok(parentSplitEvent, "Lô mẹ phải có sự kiện LOT_SPLIT");
    assert.equal(parentSplitEvent.payload.childLotIds.length, 3);
    for (const cId of childLotIds) {
      assert.ok(parentSplitEvent.payload.childLotIds.includes(cId), `Sự kiện tách lô mẹ phải nêu mã lô con ${cId}`);
    }

    // 2. Dòng thời gian từng lô con: có sự kiện khai sinh CREATED_FROM_SPLIT nêu mã lô mẹ
    for (const childId of childLotIds) {
      const childTimelineRes = await coopAgent.get(`/api/lots/${childId}/timeline`);
      assert.equal(childTimelineRes.status, 200);
      const childCreatedEvent = childTimelineRes.body.events.find((e) => e.eventType === "CREATED_FROM_SPLIT");
      assert.ok(childCreatedEvent, `Lô con ${childId} phải có sự kiện khai sinh CREATED_FROM_SPLIT`);
      assert.equal(
        childCreatedEvent.payload.parentLotId,
        splitParentLotId,
        `Sự kiện khai sinh của ${childId} phải nêu đúng mã lô mẹ`
      );
    }

    // 3. Kiểm tra toàn vẹn mọi lô liên quan (lô mẹ và cả 3 lô con)
    const parentIntegrityRes = await inspAgent.get(`/api/lots/${splitParentLotId}/integrity`);
    assert.equal(parentIntegrityRes.status, 200);
    assert.equal(parentIntegrityRes.body.integrity.valid, true, "Lô mẹ phải có chuỗi sự kiện toàn vẹn hợp lệ");

    for (const childId of childLotIds) {
      const childIntegrityRes = await inspAgent.get(`/api/lots/${childId}/integrity`);
      assert.equal(childIntegrityRes.status, 200);
      assert.equal(childIntegrityRes.body.integrity.valid, true, `Lô con ${childId} phải có chuỗi sự kiện toàn vẹn hợp lệ`);
    }
  });
});

