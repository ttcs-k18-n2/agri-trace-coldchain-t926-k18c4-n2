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
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-29: Nhà phân phối ghi nhận lô đã bán hết cho người tiêu dùng", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Setup test users for different roles & orgs
  users.set("distributor_s29@dist.vn", {
    id: "usr-dist-s29",
    email: "distributor_s29@dist.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-dist-001",
    roleId: "distributor",
  });

  users.set("producer_s29@prod.vn", {
    id: "usr-prod-s29",
    email: "producer_s29@prod.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-prod-001",
    roleId: "producer",
  });

  users.set("other_dist@dist2.vn", {
    id: "usr-dist2-s29",
    email: "other_dist@dist2.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-dist-002",
    roleId: "distributor",
  });

  users.set("inspector_s29@gov.vn", {
    id: "usr-insp-s29",
    email: "inspector_s29@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("admin_s29@system.vn", {
    id: "usr-admin-s29",
    email: "admin_s29@system.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  // Prepare test lots
  const testLot1 = "LOT-CONSUME-TEST-01";
  const testLot2 = "LOT-CONSUME-PENDING-02";
  const testLotOther = "LOT-CONSUME-OTHER-03";

  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (inMemoryLots[i].id.startsWith("LOT-CONSUME-")) {
      inMemoryLots.splice(i, 1);
    }
  }

  inMemoryLots.push({
    id: testLot1,
    name: "Lô Dưa hấu Long An",
    status: "Đã nhập kho",
    organizationId: "org-dist-001",
    farmId: null,
    productId: "PROD-WATERMELON",
    initialQuantity: 500,
    remainingQuantity: 500,
    harvestedAt: "2026-10-01T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-01T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: testLot2,
    name: "Lô Cam sành Hàm Yên",
    status: "Đang lưu kho",
    organizationId: "org-dist-001",
    farmId: null,
    productId: "PROD-ORANGE",
    initialQuantity: 300,
    remainingQuantity: 300,
    harvestedAt: "2026-10-02T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-02T07:00:00.000Z",
  });

  inMemoryLots.push({
    id: testLotOther,
    name: "Lô Thanh long Bình Thuận",
    status: "Đã nhập kho",
    organizationId: "org-dist-002",
    farmId: null,
    productId: "PROD-DRAGONFRUIT",
    initialQuantity: 400,
    remainingQuantity: 400,
    harvestedAt: "2026-10-03T07:00:00.000Z",
    parentLotId: null,
    createdAt: "2026-10-03T07:00:00.000Z",
  });

  // Gán 1 transfer PENDING cho testLot2
  for (let i = inMemoryTransfers.length - 1; i >= 0; i--) {
    if (inMemoryTransfers[i].id.startsWith("TRF-CONSUME-")) {
      inMemoryTransfers.splice(i, 1);
    }
  }
  inMemoryTransfers.push({
    id: "TRF-CONSUME-TEST-01",
    lotId: testLot2,
    fromOrganizationId: "org-dist-001",
    toOrganizationId: "org-dist-002",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });

  await t.test("1. Unauthorized role (producer, inspector) cannot consume lot (403)", async () => {
    const prodAgent = await loginAs("producer_s29@prod.vn");
    const resProd = await prodAgent.post(`/api/lots/${testLot1}/consume`).send();
    assert.equal(resProd.status, 403);

    const inspAgent = await loginAs("inspector_s29@gov.vn");
    const resInsp = await inspAgent.post(`/api/lots/${testLot1}/consume`).send();
    assert.equal(resInsp.status, 403);
  });

  await t.test("2. Cross-tenant distributor cannot consume a lot belonging to another organization (403)", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post(`/api/lots/${testLotOther}/consume`).send();
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "FORBIDDEN");
  });

  await t.test("3. Reject consuming lot when it has a pending transfer (400 PENDING_TRANSFER_EXISTS)", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post(`/api/lots/${testLot2}/consume`).send();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "PENDING_TRANSFER_EXISTS");
  });

  await t.test("4. Returns 404 if lot does not exist", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post("/api/lots/LOT-NON-EXISTENT/consume").send();
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "LOT_NOT_FOUND");
  });

  await t.test("5. Distributor successfully marks lot as consumed (200 OK, status='Đã bán hết', remaining_quantity=0, LOT_CONSUMED event appended)", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post(`/api/lots/${testLot1}/consume`).send({
      notes: "Đã phân phối hết tại siêu thị Co.opmart",
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.lot.id, testLot1);
    assert.equal(res.body.lot.status, "Đã bán hết");
    assert.equal(res.body.lot.remainingQuantity, 0);

    // Verify in-memory state updated
    const lotInMem = inMemoryLots.find((l) => l.id === testLot1);
    assert.ok(lotInMem);
    assert.equal(lotInMem.status, "Đã bán hết");
    assert.equal(lotInMem.remainingQuantity, 0);

    // Verify SHA-256 event appended to chain
    assert.ok(res.body.event);
    assert.equal(res.body.event.eventType, "LOT_CONSUMED");
    assert.equal(res.body.event.batchId, testLot1);
    assert.equal(res.body.event.payload.previousStatus, "Đã nhập kho");
    assert.equal(res.body.event.payload.consumedQuantity, 500);
    assert.equal(res.body.event.payload.notes, "Đã phân phối hết tại siêu thị Co.opmart");
    assert.ok(res.body.event.eventHash);
  });

  await t.test("6. Reject marking lot as consumed when already consumed (400 ALREADY_CONSUMED)", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post(`/api/lots/${testLot1}/consume`).send();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "ALREADY_CONSUMED");
  });

  await t.test("7. Reject splitting a consumed lot (400 LOT_ALREADY_CONSUMED)", async () => {
    const adminAgent = await loginAs("admin_s29@system.vn");
    const res = await adminAgent.post(`/api/lots/${testLot1}/split`).send({
      splits: [{ name: "Lô con", quantity: 10 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_ALREADY_CONSUMED");
  });

  await t.test("8. Reject initiating transfer for a consumed lot (400 LOT_ALREADY_CONSUMED)", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.post(`/api/lots/${testLot1}/transfers`).send({
      toOrganizationId: "org-dist-002",
      notes: "Cố bàn giao lô đã bán hết",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "LOT_ALREADY_CONSUMED");
  });

  await t.test("9. Filter lots by status (status='Đã bán hết') in GET /api/lots", async () => {
    const distAgent = await loginAs("distributor_s29@dist.vn");
    const res = await distAgent.get("/api/lots?status=%C4%90%C3%A3%20b%C3%A1n%20h%E1%BA%BFt");
    assert.equal(res.status, 200);
    assert.ok(res.body.lots.some((l) => l.id === testLot1 && l.status === "Đã bán hết"));
    assert.ok(res.body.lots.every((l) => l.status === "Đã bán hết"));
  });
});
