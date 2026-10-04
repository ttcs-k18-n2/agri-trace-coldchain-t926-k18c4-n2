const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchEvents,
  appendBatchEvent,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-23 (T-54, T-55): Quy tắc quyền xem lịch sử tổ tiên, chặn 403 lô không liên quan và giới hạn sau bàn giao giữa 3 tổ chức", async (t) => {
  const passwordHash = await hashPassword("Password123!");
  users.set("producer@org1.vn", {
    id: "usr-prod-org1",
    email: "producer@org1.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "producer",
  });
  users.set("distributor@org3.vn", {
    id: "usr-dist-org3",
    email: "distributor@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-003",
    roleId: "distributor",
  });
  const testLotIds = ["LOT-S23-ORG1", "LOT-S23-ORG2", "LOT-S23-ORG3", "LOT-S23-UNRELATED", "LOT-S23-HANDOVER"];
  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (testLotIds.includes(inMemoryLots[i].id)) inMemoryLots.splice(i, 1);
  }
  for (let i = inMemoryBatchEvents.length - 1; i >= 0; i--) {
    if (testLotIds.includes(inMemoryBatchEvents[i].batchId || inMemoryBatchEvents[i].batch_id)) {
      inMemoryBatchEvents.splice(i, 1);
    }
  }

  inMemoryLots.push(
    {
      id: "LOT-S23-ORG1",
      name: "Lô thu hoạch Vùng trồng Org 1",
      status: "Đã bàn giao",
      organizationId: "org-001",
    },
    {
      id: "LOT-S23-ORG2",
      name: "Lô sơ chế HTX Org 2",
      status: "Đã bàn giao",
      organizationId: "org-002",
      parentLotId: "LOT-S23-ORG1",
    },
    {
      id: "LOT-S23-ORG3",
      name: "Lô phân phối Org 3 đang giữ",
      status: "Đang vận chuyển",
      organizationId: "org-003",
      parentLotId: "LOT-S23-ORG2",
    },
    {
      id: "LOT-S23-UNRELATED",
      name: "Lô riêng biệt của Org 1 không liên quan tới Org 3",
      status: "Đã thu hoạch",
      organizationId: "org-001",
    },
    {
      id: "LOT-S23-HANDOVER",
      name: "Lô chuyển giao trực tiếp từ Org 1 sang Org 2",
      status: "Đang vận chuyển",
      organizationId: "org-002",
    }
  );

  await appendBatchEvent(null, {
    batchId: "LOT-S23-ORG1",
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    payload: { step: "Thu hoạch tại nông trại", organizationName: "Nông trại Xanh (Org 1)" },
  });

  await appendBatchEvent(null, {
    batchId: "LOT-S23-ORG2",
    eventType: "PROCESSING_COMPLETED",
    organizationId: "org-002",
    payload: {
      step: "Đóng gói tại HTX",
      parentLotId: "LOT-S23-ORG1",
      organizationName: "HTX Chế biến Nông sản (Org 2)",
    },
  });

  await appendBatchEvent(null, {
    batchId: "LOT-S23-ORG3",
    eventType: "RECEIVED_BY_DISTRIBUTOR",
    organizationId: "org-003",
    payload: {
      step: "Nhập kho nhà phân phối",
      parentLotId: "LOT-S23-ORG2",
      organizationName: "Nhà phân phối Chuỗi Lạnh (Org 3)",
    },
  });

  await appendBatchEvent(null, {
    batchId: "LOT-S23-HANDOVER",
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    payload: { step: "Bước 1: Org 1 thu hoạch" },
  });
  await appendBatchEvent(null, {
    batchId: "LOT-S23-HANDOVER",
    eventType: "HANDOVER_COMPLETED",
    organizationId: "org-001",
    payload: {
      step: "Bước 2: Org 1 bàn giao sang Org 2",
      fromOrganizationId: "org-001",
      toOrganizationId: "org-002",
    },
  });
  await appendBatchEvent(null, {
    batchId: "LOT-S23-HANDOVER",
    eventType: "POST_HANDOVER_PROCESS",
    organizationId: "org-002",
    payload: { step: "Bước 3: Org 2 chế biến sau khi nhận bàn giao" },
  });

  const org1Agent = await loginAs("producer@org1.vn");
  const org3Agent = await loginAs("distributor@org3.vn");

  await t.test("AC1: Nhà phân phối (Org 3) xem được lịch sử các lô tổ tiên (Org 1, Org 2) kèm tên tổ chức", async () => {
    const currentEventsRes = await org3Agent.get("/api/lots/LOT-S23-ORG3/events");
    assert.equal(currentEventsRes.status, 200);
    assert.equal(currentEventsRes.body.ancestors.length, 2);

    const anc1EventsRes = await org3Agent.get("/api/lots/LOT-S23-ORG1/events");
    assert.equal(anc1EventsRes.status, 200);
    assert.equal(anc1EventsRes.body.events.length, 1);
    assert.equal(anc1EventsRes.body.events[0].organizationId, "org-001");
    assert.ok(anc1EventsRes.body.events[0].organizationName);

    const anc1DetailRes = await org3Agent.get("/api/lots/LOT-S23-ORG1");
    assert.equal(anc1DetailRes.status, 200);
    assert.equal(anc1DetailRes.body.lot.id, "LOT-S23-ORG1");
  });

  await t.test("AC2: Nhà phân phối (Org 3) gọi API xem lô khác không liên quan của Org 1 thì bị chặn 403", async () => {
    const forbiddenDetail = await org3Agent.get("/api/lots/LOT-S23-UNRELATED");
    assert.equal(forbiddenDetail.status, 403);

    const forbiddenEvents = await org3Agent.get("/api/lots/LOT-S23-UNRELATED/events");
    assert.equal(forbiddenEvents.status, 403);
  });

  await t.test("AC3: Lô đã bàn giao đi khỏi Org 1 thì Org 1 vẫn xem được lịch sử tới lúc bàn giao nhưng không thấy bước sau đó", async () => {
    const pastEventsRes = await org1Agent.get("/api/lots/LOT-S23-HANDOVER/events");
    assert.equal(pastEventsRes.status, 200);
    assert.equal(pastEventsRes.body.events.length, 2);
    assert.equal(pastEventsRes.body.events[0].eventType, "HARVEST_CREATED");
    assert.equal(pastEventsRes.body.events[1].eventType, "HANDOVER_COMPLETED");
  });
});