const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  seedDemoUser,
  seedS22Data,
  inMemoryShipments,
  inMemoryShipmentLots,
  inMemoryLots,
  inMemoryOrgs,
} = require("../src/server");
const { inMemoryViolations } = require("../src/cold_chain_violation_service");
const { getTransporterViolationReport } = require("../src/transporter_violation_report_service");

test("Story S-54: Thống kê vi phạm chuỗi lạnh theo đơn vị vận chuyển (Jira N2-122)", async (t) => {
  await seedDemoUser();
  seedS22Data();

  // Thiết lập dữ liệu mẫu kiểm thử S-54
  inMemoryShipments.length = 0;
  inMemoryShipmentLots.length = 0;
  inMemoryViolations.length = 0;

  // Giả lập 2 đơn vị vận chuyển:
  // - org-trans-01: "Vận tải lạnh Ánh Dương"
  // - org-trans-02: "Logistics Xanh Toàn Quốc"
  const orgTrans1 = { id: "org-trans-01", name: "Vận tải lạnh Ánh Dương", role: "transporter" };
  const orgTrans2 = { id: "org-trans-02", name: "Logistics Xanh Toàn Quốc", role: "transporter" };
  const orgDist1 = { id: "org-003", name: "Tổng kho Phân phối Hà Nội", role: "distributor" };
  const orgDist2 = { id: "org-004", name: "Siêu thị Nông sản Đà Nẵng", role: "distributor" };

  // Đảm bảo các tổ chức có trong inMemoryOrgs
  if (!inMemoryOrgs.some((o) => o.id === orgTrans1.id)) inMemoryOrgs.push(orgTrans1);
  if (!inMemoryOrgs.some((o) => o.id === orgTrans2.id)) inMemoryOrgs.push(orgTrans2);
  if (!inMemoryOrgs.some((o) => o.id === orgDist1.id)) inMemoryOrgs.push(orgDist1);
  if (!inMemoryOrgs.some((o) => o.id === orgDist2.id)) inMemoryOrgs.push(orgDist2);

  // Tạo lô hàng thuộc về org-003 và org-004
  const lotDist1 = { id: "LOT-S54-01", code: "LOT-S54-01", organizationId: "org-003" };
  const lotDist2 = { id: "LOT-S54-02", code: "LOT-S54-02", organizationId: "org-004" };
  inMemoryLots.push(lotDist1, lotDist2);

  // Chuyến 1 (org-trans-01): Chở lô LOT-S54-01, có 1 vi phạm 45 phút, ngày 2026-10-05
  inMemoryShipments.push({
    id: "SHIP-01",
    organizationId: "org-trans-01",
    organizationName: "Vận tải lạnh Ánh Dương",
    startedAt: "2026-10-05T08:00:00.000Z",
    status: "COMPLETED",
  });
  inMemoryShipmentLots.push({ shipmentId: "SHIP-01", lotId: "LOT-S54-01" });
  inMemoryViolations.push({
    id: "VIO-01",
    shipmentId: "SHIP-01",
    durationMinutes: 45,
    status: "CONFIRMED",
  });

  // Chuyến 2 (org-trans-01): Chở lô LOT-S54-01, an toàn không vi phạm, ngày 2026-10-08
  inMemoryShipments.push({
    id: "SHIP-02",
    organizationId: "org-trans-01",
    organizationName: "Vận tải lạnh Ánh Dương",
    startedAt: "2026-10-08T09:00:00.000Z",
    status: "COMPLETED",
  });
  inMemoryShipmentLots.push({ shipmentId: "SHIP-02", lotId: "LOT-S54-01" });

  // Chuyến 3 (org-trans-02): Chở lô LOT-S54-01, có 2 vi phạm (30 ph + 60 ph = 90 ph), ngày 2026-10-10
  inMemoryShipments.push({
    id: "SHIP-03",
    organizationId: "org-trans-02",
    organizationName: "Logistics Xanh Toàn Quốc",
    startedAt: "2026-10-10T10:00:00.000Z",
    status: "COMPLETED",
  });
  inMemoryShipmentLots.push({ shipmentId: "SHIP-03", lotId: "LOT-S54-01" });
  inMemoryViolations.push(
    { id: "VIO-02", shipmentId: "SHIP-03", durationMinutes: 30, status: "CONFIRMED" },
    { id: "VIO-03", shipmentId: "SHIP-03", durationMinutes: 60, status: "CONFIRMED" }
  );

  // Chuyến 4 (org-trans-02): Chở lô LOT-S54-02 (CỦA TỔ CHỨC KHÁC org-004), có vi phạm 120 phút, ngày 2026-10-12
  inMemoryShipments.push({
    id: "SHIP-04",
    organizationId: "org-trans-02",
    organizationName: "Logistics Xanh Toàn Quốc",
    startedAt: "2026-10-12T10:00:00.000Z",
    status: "COMPLETED",
  });
  inMemoryShipmentLots.push({ shipmentId: "SHIP-04", lotId: "LOT-S54-02" });
  inMemoryViolations.push({
    id: "VIO-04",
    shipmentId: "SHIP-04",
    durationMinutes: 120,
    status: "CONFIRMED",
  });

  await t.test("N2-239 / N2-240: Thống kê chính xác số chuyến, số vi phạm, thời lượng và tỷ lệ %", async () => {
    // Gọi dưới quyền admin (xem toàn bộ)
    const report = await getTransporterViolationReport({
      authContext: { role: "admin", organizationId: "org-000" },
      inMemoryShipmentsList: inMemoryShipments,
      inMemoryShipmentLotsList: inMemoryShipmentLots,
      inMemoryViolationsList: inMemoryViolations,
      inMemoryLotsList: inMemoryLots,
      inMemoryOrgsList: inMemoryOrgs,
    });

    assert.equal(report.status, 200);
    assert.equal(report.summary.totalTransporters, 2);
    assert.equal(report.summary.totalShipments, 4);
    assert.equal(report.summary.violatedShipments, 3);
    assert.equal(report.summary.safeShipments, 1);
    assert.equal(report.summary.totalViolations, 4);
    assert.equal(report.summary.totalViolationMinutes, 45 + 30 + 60 + 120); // 255 phút
    assert.equal(report.summary.overallViolationRate, 75.0); // 3/4 = 75%

    // Chi tiết từng đơn vị vận chuyển
    const trans1 = report.transporters.find((t) => t.transporterId === "org-trans-01");
    assert.ok(trans1);
    assert.equal(trans1.totalShipments, 2);
    assert.equal(trans1.safeShipments, 1);
    assert.equal(trans1.violatedShipments, 1);
    assert.equal(trans1.violationCount, 1);
    assert.equal(trans1.totalViolationMinutes, 45);
    assert.equal(trans1.violationRate, 50.0);

    const trans2 = report.transporters.find((t) => t.transporterId === "org-trans-02");
    assert.ok(trans2);
    assert.equal(trans2.totalShipments, 2);
    assert.equal(trans2.violatedShipments, 2);
    assert.equal(trans2.violationCount, 3);
    assert.equal(trans2.totalViolationMinutes, 210);
    assert.equal(trans2.violationRate, 100.0);
    assert.equal(trans2.riskLevel, "HIGH");
  });

  await t.test("N2-239: Lọc chính xác theo khoảng thời gian fromDate và toDate", async () => {
    // Lọc từ 2026-10-06 đến 2026-10-11 (Chỉ có SHIP-02 và SHIP-03)
    const report = await getTransporterViolationReport({
      authContext: { role: "admin" },
      fromDate: "2026-10-06",
      toDate: "2026-10-11",
      inMemoryShipmentsList: inMemoryShipments,
      inMemoryShipmentLotsList: inMemoryShipmentLots,
      inMemoryViolationsList: inMemoryViolations,
      inMemoryLotsList: inMemoryLots,
      inMemoryOrgsList: inMemoryOrgs,
    });

    assert.equal(report.summary.totalShipments, 2);
    assert.equal(report.summary.violatedShipments, 1);
    assert.equal(report.summary.totalViolations, 2);
    assert.equal(report.summary.totalViolationMinutes, 90);
  });

  await t.test("N2-239 / T-12: Tenant Isolation - Nhà phân phối chỉ xem chuyến chở lô của mình, không thấy chuyến của bên khác", async () => {
    // Gọi dưới quyền của Nhà phân phối org-003
    const reportDist1 = await getTransporterViolationReport({
      authContext: { role: "distributor", organizationId: "org-003" },
      inMemoryShipmentsList: inMemoryShipments,
      inMemoryShipmentLotsList: inMemoryShipmentLots,
      inMemoryViolationsList: inMemoryViolations,
      inMemoryLotsList: inMemoryLots,
      inMemoryOrgsList: inMemoryOrgs,
    });

    // Chỉ có 3 chuyến chở lô của org-003 (SHIP-01, SHIP-02, SHIP-03).
    // SHIP-04 chở lô của org-004 tuyệt đối KHÔNG được xuất hiện!
    assert.equal(reportDist1.summary.totalShipments, 3);
    assert.equal(reportDist1.summary.violatedShipments, 2);
    assert.equal(reportDist1.summary.totalViolationMinutes, 45 + 90); // 135 phút (không có 120 phút của SHIP-04)

    const trans2 = reportDist1.transporters.find((t) => t.transporterId === "org-trans-02");
    assert.equal(trans2.totalShipments, 1); // Chỉ thấy 1 chuyến của mình
    assert.equal(trans2.totalViolationMinutes, 90);
  });

  await t.test("N2-239: REST API GET /api/reports/transporter-violations và kiểm tra phân quyền RBAC", async () => {
    // 1. Chưa đăng nhập -> 401
    const unauthRes = await request(app).get("/api/reports/transporter-violations");
    assert.equal(unauthRes.status, 401);

    // 2. Đăng nhập quyền Distributor hợp lệ
    const agent = request.agent(app);
    const loginRes = await agent.post("/api/login").send({
      email: "distributor@example.com",
      password: "Password@123",
    });
    assert.equal(loginRes.status, 200);

    const apiRes = await agent.get("/api/reports/transporter-violations?from=2026-10-01&to=2026-10-31");
    assert.equal(apiRes.status, 200);
    assert.ok(apiRes.body.summary !== undefined);
    assert.ok(Array.isArray(apiRes.body.transporters));
  });

  await t.test("N2-306: Kiểm tra giao diện DOM và HTML của báo cáo transporter-violations.html", () => {
    const htmlPath = path.resolve(__dirname, "../../frontend/transporter-violations.html");
    assert.ok(fs.existsSync(htmlPath), "Tệp HTML báo cáo phải tồn tại");

    const content = fs.readFileSync(htmlPath, "utf8");
    assert.ok(content.includes('id="transporter-table"'), "Phải có bảng thống kê đơn vị vận chuyển");
    assert.ok(content.includes('id="filter-from-date"'), "Phải có trường lọc từ ngày");
    assert.ok(content.includes('id="filter-to-date"'), "Phải có trường lọc đến ngày");
    assert.ok(content.includes('id="summary-total-transporters"'), "Phải có thẻ tổng số đơn vị vận chuyển");
    assert.ok(content.includes('id="summary-violation-rate"'), "Phải có thẻ tỷ lệ vi phạm");
    assert.ok(content.includes("initAppShell"), "Phải khởi tạo app-shell đồng bộ hệ thống");
  });
});
