const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  seedDemoUser,
  inMemoryLots,
  inMemoryFarms,
  inMemoryAuditLogs,
} = require("../src/server");
const { getAuditLogs } = require("../src/audit_logger");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

function setupTestDataset() {
  inMemoryLots.length = 0;
  inMemoryAuditLogs.length = 0;

  inMemoryLots.push(
    {
      id: "LOT-TOMATO-01",
      name: "Cà chua hữu cơ Đà Lạt",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      farmId: "FARM-DALAT-01",
      productId: "PROD-TOMATO",
      initialQuantity: 500,
      remainingQuantity: 500,
      harvestedAt: "2026-09-25",
      createdAt: "2026-09-25T08:00:00.000Z",
    },
    {
      id: "LOT-TEA-02",
      name: "Chè Tân Cương đặc sản",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      farmId: "FARM-THAINGUYEN-01",
      productId: "PROD-TEA",
      initialQuantity: 200,
      remainingQuantity: 200,
      harvestedAt: "2026-09-27",
      createdAt: "2026-09-27T08:00:00.000Z",
    },
    {
      id: "LOT-VEG-03",
      name: "Rau cải sạch Yên Dũng",
      status: "Đã thu hoạch",
      organizationId: "org-002",
      farmId: "FARM-BACGIANG-01",
      productId: "PROD-VEGETABLE",
      initialQuantity: 300,
      remainingQuantity: 300,
      harvestedAt: "2026-09-28",
      createdAt: "2026-09-28T09:00:00.000Z",
    },
    {
      id: "LOT-CUCUMBER-04",
      name: "Dưa chuột bao tử Hiệp Hòa",
      status: "Đang vận chuyển",
      organizationId: "org-002",
      farmId: "FARM-BACGIANG-01",
      productId: "PROD-VEGETABLE",
      initialQuantity: 150,
      remainingQuantity: 150,
      harvestedAt: "2026-10-02",
      createdAt: "2026-10-02T10:00:00.000Z",
    }
  );

  // Thêm farms mẫu nếu chưa có
  if (!inMemoryFarms.some((f) => f.id === "FARM-DALAT-01")) {
    inMemoryFarms.push({
      id: "FARM-DALAT-01",
      name: "Nông trại Cà chua Đà Lạt",
      area: 2.5,
      organizationId: "org-001",
    });
  }
  if (!inMemoryFarms.some((f) => f.id === "FARM-BACGIANG-01")) {
    inMemoryFarms.push({
      id: "FARM-BACGIANG-01",
      name: "Thửa rau sạch Yên Dũng",
      area: 4.0,
      organizationId: "org-002",
    });
  }
}

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
  setupTestDataset();
});

test("TC01: Cán bộ kiểm tra tìm kiếm theo mã lô chính xác (cross-tenant)", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Tìm lô của org-001
  const res1 = await inspectorAgent.get("/api/organization/lots?search=LOT-TOMATO-01");
  assert.equal(res1.status, 200);
  assert.equal(res1.body.lots.length, 1);
  assert.equal(res1.body.lots[0].id, "LOT-TOMATO-01");
  assert.equal(res1.body.lots[0].organizationId, "org-001");

  // Tìm lô của org-002
  const res2 = await inspectorAgent.get("/api/organization/lots?search=LOT-VEG-03");
  assert.equal(res2.status, 200);
  assert.equal(res2.body.lots.length, 1);
  assert.equal(res2.body.lots[0].id, "LOT-VEG-03");
  assert.equal(res2.body.lots[0].organizationId, "org-002");
});

test("TC02: Cán bộ kiểm tra tìm kiếm theo tiền tố hoặc không phân biệt chữ hoa/thường", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Tìm bằng chữ thường "tomato"
  const res = await inspectorAgent.get("/api/organization/lots?search=tomato");
  assert.equal(res.status, 200);
  assert.equal(res.body.lots.length, 1);
  assert.equal(res.body.lots[0].id, "LOT-TOMATO-01");

  // Tìm theo tên sản phẩm / tên lô "cà chua"
  const resName = await inspectorAgent.get("/api/organization/lots?search=cà chua");
  assert.equal(resName.status, 200);
  assert.ok(resName.body.lots.some((l) => l.id === "LOT-TOMATO-01"));
});

test("TC03: Cán bộ kiểm tra lọc theo vùng trồng (farmId)", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Lọc theo vùng trồng FARM-BACGIANG-01 (có 2 lô)
  const res = await inspectorAgent.get("/api/organization/lots?farmId=FARM-BACGIANG-01");
  assert.equal(res.status, 200);
  assert.equal(res.body.lots.length, 2);
  const ids = res.body.lots.map((l) => l.id).sort();
  assert.deepEqual(ids, ["LOT-CUCUMBER-04", "LOT-VEG-03"]);
  assert.ok(res.body.lots.every((l) => l.farmId === "FARM-BACGIANG-01"));

  // Lọc theo vùng trồng không có lô nào
  const resEmpty = await inspectorAgent.get("/api/organization/lots?farmId=FARM-NONEXISTENT");
  assert.equal(resEmpty.status, 200);
  assert.equal(resEmpty.body.lots.length, 0);
});

test("TC04: Cán bộ kiểm tra lọc theo khoảng ngày thu hoạch (harvestedFrom, harvestedTo)", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Lọc từ ngày 2026-09-26 đến 2026-09-28 (chứa LOT-TEA-02 ngày 27 và LOT-VEG-03 ngày 28)
  const res = await inspectorAgent.get("/api/organization/lots?harvestedFrom=2026-09-26&harvestedTo=2026-09-28");
  assert.equal(res.status, 200);
  assert.equal(res.body.lots.length, 2);
  const ids = res.body.lots.map((l) => l.id).sort();
  assert.deepEqual(ids, ["LOT-TEA-02", "LOT-VEG-03"]);

  // Chỉ lọc từ ngày 2026-10-01 trở đi
  const resFrom = await inspectorAgent.get("/api/organization/lots?harvestedFrom=2026-10-01");
  assert.equal(resFrom.status, 200);
  assert.equal(resFrom.body.lots.length, 1);
  assert.equal(resFrom.body.lots[0].id, "LOT-CUCUMBER-04");

  // Chỉ lọc đến ngày 2026-09-25
  const resTo = await inspectorAgent.get("/api/organization/lots?harvestedTo=2026-09-25");
  assert.equal(resTo.status, 200);
  assert.equal(resTo.body.lots.length, 1);
  assert.equal(resTo.body.lots[0].id, "LOT-TOMATO-01");
});

test("TC05: Kết hợp đa tiêu chí (farmId + khoảng ngày) kèm phân trang (limit, cursor)", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Kết hợp farmId và khoảng ngày bao gồm cả 2 lô của FARM-BACGIANG-01 nhưng limit 1
  const resPage1 = await inspectorAgent.get(
    "/api/organization/lots?farmId=FARM-BACGIANG-01&harvestedFrom=2026-09-01&limit=1"
  );
  assert.equal(resPage1.status, 200);
  assert.equal(resPage1.body.lots.length, 1);
  assert.equal(resPage1.body.lots[0].id, "LOT-CUCUMBER-04"); // Mới nhất (2026-10-02)
  assert.equal(resPage1.body.hasMore, true);
  assert.ok(resPage1.body.nextCursor, "nextCursor must be returned");

  // Tải trang 2 qua cursor
  const resPage2 = await inspectorAgent.get(
    `/api/organization/lots?farmId=FARM-BACGIANG-01&harvestedFrom=2026-09-01&limit=1&cursor=${resPage1.body.nextCursor}`
  );
  assert.equal(resPage2.status, 200);
  assert.equal(resPage2.body.lots.length, 1);
  assert.equal(resPage2.body.lots[0].id, "LOT-VEG-03"); // Lô tiếp theo (2026-09-28)
});

test("TC06: Mọi lượt tra cứu của Cán bộ kiểm tra đều được ghi nhận vào nhật ký S-31", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Trước khi tra cứu: 0 log
  inMemoryAuditLogs.length = 0;

  // Lượt tra cứu 1: tìm theo mã
  await inspectorAgent.get("/api/organization/lots?search=LOT-TOMATO-01");

  // Lượt tra cứu 2: tìm theo vùng trồng và khoảng ngày
  await inspectorAgent.get("/api/organization/lots?farmId=FARM-BACGIANG-01&harvestedFrom=2026-09-01&harvestedTo=2026-10-31");

  // Kiểm tra nhật ký kiểm toán S-31 qua getAuditLogs
  const auditResult = await getAuditLogs({
    inMemoryLogs: inMemoryAuditLogs,
    action: "INSPECTOR_LOT_SEARCH",
  });

  assert.equal(auditResult.total, 2, "Phải ghi nhận đủ 2 lượt tra cứu vào S-31");
  const log2 = auditResult.logs[0]; // Mới nhất (Lượt tra cứu 2)
  assert.equal(log2.action, "INSPECTOR_LOT_SEARCH");
  assert.equal(log2.actorEmail, "inspector@example.com");
  assert.equal(log2.details.criteria.farmId, "FARM-BACGIANG-01");
  assert.equal(log2.details.criteria.harvestedFrom, "2026-09-01");
  assert.equal(log2.details.criteria.harvestedTo, "2026-10-31");
  assert.equal(log2.details.resultCount, 2);

  const log1 = auditResult.logs[1]; // Lượt tra cứu 1
  assert.equal(log1.action, "INSPECTOR_LOT_SEARCH");
  assert.equal(log1.details.criteria.search, "LOT-TOMATO-01");
  assert.equal(log1.details.resultCount, 1);
});

test("TC07: Người dùng doanh nghiệp thông thường bị cách ly dữ liệu và KHÔNG ghi log inspector", async () => {
  const user1Agent = await loginAs("user@example.com"); // org-001

  inMemoryAuditLogs.length = 0;

  // Tra cứu không kèm filter
  const res1 = await user1Agent.get("/api/organization/lots");
  assert.equal(res1.status, 200);
  // Chỉ thấy các lô của org-001
  assert.ok(res1.body.lots.every((l) => l.organizationId === "org-001"));
  assert.ok(!res1.body.lots.some((l) => l.organizationId === "org-002"));

  // Thử tìm kiếm mã lô của org-002 -> không tìm thấy
  const resCross = await user1Agent.get("/api/organization/lots?search=LOT-VEG-03");
  assert.equal(resCross.status, 200);
  assert.equal(resCross.body.lots.length, 0);

  // Xác nhận KHÔNG ghi log INSPECTOR_LOT_SEARCH cho doanh nghiệp
  const inspectorLogs = inMemoryAuditLogs.filter((l) => l.action === "INSPECTOR_LOT_SEARCH");
  assert.equal(inspectorLogs.length, 0);
});

test("TC08: Chế độ chỉ đọc - Cán bộ kiểm tra bị nghiêm cấm mọi thao tác ghi (403 Forbidden)", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // 1. Cấm tạo lô hàng mới
  const createRes = await inspectorAgent.post("/api/lots").send({
    farmId: "FARM-DALAT-01",
    productId: "PROD-TOMATO",
    quantity: 100,
    harvestedAt: "2026-10-15",
  });
  assert.equal(createRes.status, 403, "Inspector không được phép tạo lô hàng");

  // 2. Cấm tạo lô theo API cũ
  const createLegacyRes = await inspectorAgent.post("/api/organization/lots").send({
    name: "Lô trái phép",
  });
  assert.equal(createLegacyRes.status, 403);

  // 3. Cấm tách lô
  const splitRes = await inspectorAgent.post("/api/lots/LOT-TOMATO-01/split").send({
    portions: [200, 300],
  });
  assert.equal(splitRes.status, 403, "Inspector không được phép tách lô");

  // 4. Cấm gộp lô
  const mergeRes = await inspectorAgent.post("/api/lots/merge").send({
    parentLotIds: ["LOT-TOMATO-01", "LOT-TEA-02"],
    name: "Lô gộp trái phép",
  });
  assert.equal(mergeRes.status, 403, "Inspector không được phép gộp lô");
});

test("TC09: Cán bộ kiểm tra xem chi tiết lô hàng ghi nhận S-31 INSPECTOR_LOT_VIEW", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");
  inMemoryAuditLogs.length = 0;

  const detailRes = await inspectorAgent.get("/api/lots/LOT-TOMATO-01");
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.lot.id, "LOT-TOMATO-01");

  const viewLogs = inMemoryAuditLogs.filter((l) => l.action === "INSPECTOR_LOT_VIEW");
  assert.equal(viewLogs.length, 1);
  assert.equal(viewLogs[0].actorEmail, "inspector@example.com");
  assert.equal(viewLogs[0].resourceId, "LOT-TOMATO-01");
  assert.equal(viewLogs[0].details.lotId, "LOT-TOMATO-01");
});
