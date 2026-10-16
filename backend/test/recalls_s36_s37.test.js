const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");

const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  inMemoryOrgs,
  inMemoryOrganizations,
  inMemoryRecallOrders,
  inMemoryRecallAcknowledgments,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-36 & S-37: Recall acknowledgments and progress tracking", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Setup test users across organizations
  users.set("inspector_s36@gov.vn", {
    id: "usr-insp-s36",
    email: "inspector_s36@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-INSP",
    roleId: "inspector",
  });

  users.set("producer_s36@farm.vn", {
    id: "usr-prod-s36",
    email: "producer_s36@farm.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-PROD",
    roleId: "producer",
  });

  users.set("dist1_s36@dist.vn", {
    id: "usr-dist1-s36",
    email: "dist1_s36@dist.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-DIST-1",
    roleId: "distributor",
  });

  users.set("dist2_s36@dist.vn", {
    id: "usr-dist2-s36",
    email: "dist2_s36@dist.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-DIST-2",
    roleId: "distributor",
  });

  users.set("unrelated_s36@other.vn", {
    id: "usr-other-s36",
    email: "unrelated_s36@other.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-UNRELATED",
    roleId: "distributor",
  });

  // Setup test organizations
  const orgs = [
    { id: "ORG-PROD", name: "Trang trại Hữu cơ Ba Vì" },
    { id: "ORG-DIST-1", name: "Tổng kho Phân phối Miền Bắc" },
    { id: "ORG-DIST-2", name: "Tổng kho Phân phối Miền Nam" },
    { id: "ORG-UNRELATED", name: "Công ty Không liên quan" },
  ];
  for (const o of orgs) {
    if (!inMemoryOrgs.some((x) => x.id === o.id)) inMemoryOrgs.push(o);
    if (inMemoryOrganizations && !inMemoryOrganizations.some((x) => x.id === o.id)) inMemoryOrganizations.push(o);
  }

  // Setup test lots: root lot produced by ORG-PROD, split into child lots at ORG-DIST-1 and ORG-DIST-2
  const rootLotId = "LOT-RECALL-TEST-001";
  const child1LotId = "LOT-RECALL-TEST-002";
  const child2LotId = "LOT-RECALL-TEST-003";

  // Clean old lots/relations if present
  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if ([rootLotId, child1LotId, child2LotId].includes(inMemoryLots[i].id)) {
      inMemoryLots.splice(i, 1);
    }
  }
  for (let i = inMemoryBatchRelations.length - 1; i >= 0; i--) {
    const p = inMemoryBatchRelations[i].parentBatchId || inMemoryBatchRelations[i].parent_batch_id;
    const c = inMemoryBatchRelations[i].childBatchId || inMemoryBatchRelations[i].child_batch_id;
    if ([rootLotId, child1LotId, child2LotId].includes(p) || [rootLotId, child1LotId, child2LotId].includes(c)) {
      inMemoryBatchRelations.splice(i, 1);
    }
  }

  inMemoryLots.push({
    id: rootLotId,
    name: "Lô Dưa lưới gốc",
    status: "Đã thu hoạch",
    organizationId: "ORG-PROD",
    initialQuantity: 1000,
    remainingQuantity: 0,
    productUnit: "kg",
    createdAt: new Date().toISOString(),
  });

  inMemoryLots.push({
    id: child1LotId,
    name: "Lô Dưa lưới phân phối MB",
    status: "Đã nhập kho",
    organizationId: "ORG-DIST-1",
    initialQuantity: 500,
    remainingQuantity: 500,
    productUnit: "kg",
    createdAt: new Date().toISOString(),
  });

  inMemoryLots.push({
    id: child2LotId,
    name: "Lô Dưa lưới phân phối MN",
    status: "Đã nhập kho",
    organizationId: "ORG-DIST-2",
    initialQuantity: 500,
    remainingQuantity: 500,
    productUnit: "kg",
    createdAt: new Date().toISOString(),
  });

  inMemoryBatchRelations.push({
    parentBatchId: rootLotId,
    childBatchId: child1LotId,
    relationType: "SPLIT",
    quantity: 500,
    organizationId: "ORG-PROD",
  });

  inMemoryBatchRelations.push({
    parentBatchId: rootLotId,
    childBatchId: child2LotId,
    relationType: "SPLIT",
    quantity: 500,
    organizationId: "ORG-PROD",
  });

  // Setup a test recall order for root lot
  const recallId = "REC-TEST-2026-001";
  if (Array.isArray(inMemoryRecallOrders)) {
    const existingIdx = inMemoryRecallOrders.findIndex((o) => o.id === recallId);
    if (existingIdx >= 0) inMemoryRecallOrders.splice(existingIdx, 1);
    inMemoryRecallOrders.push({
      id: recallId,
      lotId: rootLotId,
      reason: "Phát hiện tồn dư thuốc bảo vệ thực vật vượt ngưỡng",
      severity: "CRITICAL",
      status: "OPEN",
      createdBy: "usr-prod-s36",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Clear acknowledgments for this recall
  if (Array.isArray(inMemoryRecallAcknowledgments)) {
    for (let i = inMemoryRecallAcknowledgments.length - 1; i >= 0; i--) {
      if (inMemoryRecallAcknowledgments[i].recallId === recallId) {
        inMemoryRecallAcknowledgments.splice(i, 1);
      }
    }
  }

  const unauthClient = request(app);
  const dist1Agent = await loginAs("dist1_s36@dist.vn");
  const dist2Agent = await loginAs("dist2_s36@dist.vn");
  const unrelatedAgent = await loginAs("unrelated_s36@other.vn");
  const inspectorAgent = await loginAs("inspector_s36@gov.vn");
  const producerAgent = await loginAs("producer_s36@farm.vn");

  // 1. Migration tests
  await t.test("Migration: 024 schema creates recall_acknowledgments with VARCHAR(64) FK, UNIQUE constraint, indexes and down migration", () => {
    const upPath = path.resolve(__dirname, "../../db/migrations/024_recall_acknowledgments.sql");
    const downPath = path.resolve(__dirname, "../../db/migrations/down/024_recall_acknowledgments.down.sql");

    assert.ok(fs.existsSync(upPath), "Migration 024 up file must exist");
    assert.ok(fs.existsSync(downPath), "Migration 024 down file must exist");

    const upSql = fs.readFileSync(upPath, "utf-8");
    const downSql = fs.readFileSync(downPath, "utf-8");

    // VARCHAR(64) FK-compatible recall_id
    assert.match(upSql, /recall_id\s+VARCHAR\(64\)/i, "recall_id must be VARCHAR(64)");
    // References recall_orders(id)
    assert.match(upSql, /REFERENCES\s+recall_orders\s*\(\s*id\s*\)/i, "recall_id must reference recall_orders(id)");
    // UNIQUE constraint per organization per recall
    assert.match(upSql, /UNIQUE\s*\(\s*recall_id\s*,\s*organization_id\s*\)/i, "Must have UNIQUE (recall_id, organization_id)");
    // Indexes on foreign key columns
    assert.match(upSql, /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+recall_acknowledgments\s*\(\s*recall_id\s*\)/i, "Index on recall_id");
    assert.match(upSql, /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+recall_acknowledgments\s*\(\s*organization_id\s*\)/i, "Index on organization_id");

    // Down migration drops recall_acknowledgments
    assert.match(downSql, /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?recall_acknowledgments/i, "Down migration must drop recall_acknowledgments");
  });

  // 2. Authentication on every route
  await t.test("Auth: Unauthenticated requests are rejected with 401", async () => {
    const r1 = await unauthClient.get(`/api/recalls/${recallId}/progress`);
    assert.equal(r1.status, 401, "GET progress requires auth");

    const r2 = await unauthClient.get("/api/recalls/pending");
    assert.equal(r2.status, 401, "GET pending requires auth");

    const r3 = await unauthClient.post(`/api/recalls/${recallId}/acknowledgments`).send({ note: "test" });
    assert.equal(r3.status, 401, "POST acknowledgments requires auth");

    const r4 = await unauthClient.get(`/api/recalls/${recallId}/acknowledgments`);
    assert.equal(r4.status, 401, "GET acknowledgments requires auth");
  });

  // 3. Tenant scoping & permission checks
  await t.test("Tenant scoping: Unrelated organization gets 403 on progress and cannot acknowledge", async () => {
    // Unrelated org cannot view progress
    const rProg = await unrelatedAgent.get(`/api/recalls/${recallId}/progress`);
    assert.equal(rProg.status, 403, "Unrelated organization cannot view recall progress");

    // Unrelated org cannot post acknowledgment
    const rAck = await unrelatedAgent.post(`/api/recalls/${recallId}/acknowledgments`).send({ note: "hacking" });
    assert.equal(rAck.status, 403, "Unrelated organization cannot acknowledge recall");

    // Inspector cannot post acknowledgment (inspectors are read-only)
    const rInspAck = await inspectorAgent.post(`/api/recalls/${recallId}/acknowledgments`).send({ note: "inspector ack" });
    assert.equal(rInspAck.status, 403, "Inspector cannot post acknowledgment");

    // Unrelated org sees empty array for pending recalls
    const rPending = await unrelatedAgent.get("/api/recalls/pending");
    assert.equal(rPending.status, 200);
    assert.deepEqual(rPending.body, [], "Unrelated organization has no pending recalls");
  });

  // 4. Initial progress & pending recalls
  await t.test("Progress & Pending: Initial state before any acknowledgment", async () => {
    const progRes = await producerAgent.get(`/api/recalls/${recallId}/progress`);
    assert.equal(progRes.status, 200);
    assert.equal(progRes.body.recall_id, recallId);
    assert.equal(progRes.body.acknowledged_count, 0);
    assert.equal(progRes.body.expected_count, 2);
    assert.equal(progRes.body.status, "OPEN");
    assert.equal(progRes.body.pending_organizations.length, 2);

    const pendingIds = progRes.body.pending_organizations.map((o) => o.id);
    assert.ok(pendingIds.includes("ORG-DIST-1"));
    assert.ok(pendingIds.includes("ORG-DIST-2"));

    // Check GET /api/recalls/pending for ORG-DIST-1
    const p1Res = await dist1Agent.get("/api/recalls/pending");
    assert.equal(p1Res.status, 200);
    assert.ok(Array.isArray(p1Res.body));
    const pendingItem1 = p1Res.body.find((p) => p.recall_id === recallId);
    assert.ok(pendingItem1, "ORG-DIST-1 must have pending recall");
    assert.equal(pendingItem1.recall_id, recallId);
    assert.equal(pendingItem1.pending_organizations_count, 2);
  });

  // 5. First acknowledgment & derive organization from req.auth (never trust body org_name)
  await t.test("S-36: First acknowledgment derives org from auth and ignores body spoofing", async () => {
    // Attempt spoofing with a fake org_name in body
    const ackRes = await dist1Agent
      .post(`/api/recalls/${recallId}/acknowledgments`)
      .send({
        org_name: "Evil Spoofed Corp",
        note: "Đã niêm phong kho lạnh phía Bắc",
      });

    assert.equal(ackRes.status, 201, `Failed to post acknowledgment: ${JSON.stringify(ackRes.body)}`);
    assert.equal(ackRes.body.data.organization_id, "ORG-DIST-1");
    // org_name should be resolved to the real organization name, not the spoofed string
    assert.equal(ackRes.body.data.org_name, "Tổng kho Phân phối Miền Bắc");

    // Duplicate acknowledgment attempt from same org must be rejected (unique constraint)
    const dupRes = await dist1Agent
      .post(`/api/recalls/${recallId}/acknowledgments`)
      .send({ note: "Thử xác nhận lần 2" });
    assert.equal(dupRes.status, 409, "Duplicate acknowledgment must return 409 Conflict");

    // Progress should now show 1/2 acknowledged
    const progRes = await dist1Agent.get(`/api/recalls/${recallId}/progress`);
    assert.equal(progRes.status, 200);
    assert.equal(progRes.body.acknowledged_count, 1);
    assert.equal(progRes.body.expected_count, 2);
    assert.equal(progRes.body.status, "OPEN");
    assert.equal(progRes.body.pending_organizations.length, 1);
    assert.equal(progRes.body.pending_organizations[0].id, "ORG-DIST-2");

    // ORG-DIST-1 should no longer see this recall in GET /api/recalls/pending
    const p1Res = await dist1Agent.get("/api/recalls/pending");
    assert.equal(p1Res.status, 200);
    const item1 = p1Res.body.find((p) => p.recall_id === recallId);
    assert.equal(item1, undefined, "ORG-DIST-1 already acknowledged, should not be pending");

    // ORG-DIST-2 still sees it with pending_organizations_count = 1
    const p2Res = await dist2Agent.get("/api/recalls/pending");
    assert.equal(p2Res.status, 200);
    const item2 = p2Res.body.find((p) => p.recall_id === recallId);
    assert.ok(item2, "ORG-DIST-2 still has this pending recall");
    assert.equal(item2.pending_organizations_count, 1);
  });

  // 6. Final acknowledgment completes order and writes append-only event atomically
  await t.test("S-37: Final acknowledgment completes order and writes append-only event atomically", async () => {
    const ackRes = await dist2Agent
      .post(`/api/recalls/${recallId}/acknowledgments`)
      .send({
        note: "Đã thu hồi toàn bộ lô tại kho Miền Nam",
      });

    assert.equal(ackRes.status, 201);

    // Progress should now be COMPLETED with 2/2
    const progRes = await inspectorAgent.get(`/api/recalls/${recallId}/progress`);
    assert.equal(progRes.status, 200);
    assert.equal(progRes.body.acknowledged_count, 2);
    assert.equal(progRes.body.expected_count, 2);
    assert.equal(progRes.body.status, "COMPLETED");
    assert.equal(progRes.body.pending_organizations.length, 0);

    // Order status in memory/db must be COMPLETED
    const order = inMemoryRecallOrders.find((o) => o.id === recallId);
    assert.ok(order);
    assert.equal(order.status, "COMPLETED");

    // Verify append-only event was written for batchId = rootLotId with eventType = "RECALL_COMPLETED"
    const completedEvent = inMemoryBatchEvents.find(
      (e) =>
        (e.batchId === rootLotId || e.batch_id === rootLotId) &&
        (e.eventType === "RECALL_COMPLETED" || e.event_type === "RECALL_COMPLETED")
    );
    assert.ok(completedEvent, "Must write RECALL_COMPLETED event to append-only log");
    const payload = completedEvent.payload || {};
    assert.equal(payload.recallId, recallId);
    assert.equal(payload.acknowledgedCount, 2);

    // No organizations should have this pending anymore
    const p2Res = await dist2Agent.get("/api/recalls/pending");
    const item2 = p2Res.body.find((p) => p.recall_id === recallId);
    assert.equal(item2, undefined, "Completed recall must not appear in pending list");
  });

  // 7. S-37 Acceptance Criterion: 5 related organizations, 3 acknowledged -> shows 3/5 with pending org names
  await t.test("S-37 AC: 3/5 progress tracking with pending organization names and string recall ID", async () => {
    const stringRecallId = "REC-20261017-ABC999";
    const testRootLot = "LOT-RECALL-TEST-5ORGS";

    const fiveOrgs = [
      { id: "ORG-S37-1", name: "Trang trại Hải Dương" },
      { id: "ORG-S37-2", name: "Hợp tác xã Nam Sách" },
      { id: "ORG-S37-3", name: "Đơn vị Vận chuyển An Phát" },
      { id: "ORG-S37-4", name: "Tổng kho Phân phối Hà Nội" },
      { id: "ORG-S37-5", name: "Siêu thị Nông sản Xanh" },
    ];

    for (const org of fiveOrgs) {
      if (!inMemoryOrgs.some((x) => x.id === org.id)) inMemoryOrgs.push(org);
      if (inMemoryOrganizations && !inMemoryOrganizations.some((x) => x.id === org.id)) {
        inMemoryOrganizations.push(org);
      }
      users.set(`user_${org.id.toLowerCase()}@test.vn`, {
        id: `usr-${org.id.toLowerCase()}`,
        email: `user_${org.id.toLowerCase()}@test.vn`,
        passwordHash,
        failedCount: 0,
        lockedUntil: null,
        organizationId: org.id,
        roleId: "distributor",
      });
    }

    inMemoryLots.push({
      id: testRootLot,
      name: "Lô Cà rốt xuất khẩu",
      status: "Có sự cố",
      organizationId: "ORG-S37-1",
      initialQuantity: 2000,
      remainingQuantity: 0,
      productUnit: "kg",
      createdAt: new Date().toISOString(),
    });

    // Create recall order with targetOrganizationIds covering all 5 orgs
    inMemoryRecallOrders.push({
      id: stringRecallId,
      lotId: testRootLot,
      reason: "Dư lượng nitrate vượt tiêu chuẩn xuất khẩu EU",
      severity: "HIGH",
      status: "OPEN",
      createdBy: "usr-insp-s36",
      targetOrganizationIds: fiveOrgs.map((o) => o.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agentOrg1 = await loginAs("user_org-s37-1@test.vn");
    const agentOrg2 = await loginAs("user_org-s37-2@test.vn");
    const agentOrg3 = await loginAs("user_org-s37-3@test.vn");

    // Org 1, 2, 3 acknowledge
    const res1 = await agentOrg1.post(`/api/recalls/${stringRecallId}/acknowledgments`).send({ note: "Đã phong tỏa tại trại" });
    assert.equal(res1.status, 201);
    const res2 = await agentOrg2.post(`/api/recalls/${stringRecallId}/acknowledgments`).send({ note: "Đã dừng đóng gói" });
    assert.equal(res2.status, 201);
    const res3 = await agentOrg3.post(`/api/recalls/${stringRecallId}/acknowledgments`).send({ note: "Đã thu hồi xe vận chuyển" });
    assert.equal(res3.status, 201);

    // Inspector checks progress: must show 3/5 with pending organization names
    const progRes = await inspectorAgent.get(`/api/recalls/${stringRecallId}/progress`);
    assert.equal(progRes.status, 200);
    assert.equal(progRes.body.recall_id, stringRecallId);
    assert.equal(progRes.body.acknowledged_count, 3);
    assert.equal(progRes.body.expected_count, 5);
    assert.equal(progRes.body.status, "OPEN");

    assert.equal(progRes.body.pending_organizations.length, 2);
    const pendingNames = progRes.body.pending_organizations.map((o) => o.name);
    assert.ok(pendingNames.includes("Tổng kho Phân phối Hà Nội"), "Must include pending org 4 name");
    assert.ok(pendingNames.includes("Siêu thị Nông sản Xanh"), "Must include pending org 5 name");
    const pendingIds = progRes.body.pending_organizations.map((o) => o.id);
    assert.ok(pendingIds.includes("ORG-S37-4"));
    assert.ok(pendingIds.includes("ORG-S37-5"));
  });
});

