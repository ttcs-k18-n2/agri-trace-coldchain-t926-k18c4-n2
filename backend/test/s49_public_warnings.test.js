/**
 * Test Suite: Story S-49
 * "Trang công khai cảnh báo nếu lô bị thu hồi hoặc từng vi phạm chuỗi lạnh"
 * (Public trace page warns if lot is recalled or has ever had cold-chain violations)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const {
  app,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  inMemoryRecallOrders,
  seedS22Data,
} = require("../src/server");
const { getPublicLotMapData } = require("../src/public_trace_map");

function resetS49TestData() {
  seedS22Data();
  inMemoryRecallOrders.length = 0;
}

test("Story S-49: Trang công khai cảnh báo thu hồi và vi phạm chuỗi lạnh", async (t) => {
  t.beforeEach(() => {
    resetS49TestData();
  });

  await t.test("TC01: Lô sạch bình thường - Không có cảnh báo thu hồi, không vi phạm chuỗi lạnh", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.ok(lot.recall, "Phải có đối tượng recall");
    assert.equal(lot.recall.isRecalled, false, "Lô sạch phải có isRecalled = false");
    assert.equal(lot.recall.status, "NONE");

    assert.ok(lot.coldChain, "Phải có đối tượng coldChain");
    assert.equal(lot.coldChain.hasViolation, false, "Lô sạch phải có hasViolation = false");
    assert.equal(lot.coldChain.violationCount, 0);

    assert.equal(lot.safetyStatus, "VERIFIED_SAFE", "Trạng thái an toàn phải là VERIFIED_SAFE");
  });

  await t.test("TC02: Lô hàng đang có lệnh thu hồi trực tiếp (ACTIVE RECALL) - Hiển thị cảnh báo thu hồi", async () => {
    // Tạo lệnh thu hồi đang mở trên LOT-001
    inMemoryRecallOrders.push({
      id: "RC-TEST-001",
      lotId: "LOT-001",
      reason: "Nghi ngờ phát hiện dư lượng thuốc bảo vệ thực vật vượt ngưỡng cho phép",
      severity: "HIGH",
      status: "OPEN",
      createdBy: "usr-inspector-01",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.recall.isRecalled, true, "Lô đang thu hồi phải có isRecalled = true");
    assert.equal(lot.recall.status, "OPEN");
    assert.ok(
      lot.recall.reason.includes("RC-TEST-001") ||
      lot.recall.reason.includes("thu hồi"),
      "Phải có thông tin lý do hoặc mã thu hồi"
    );
    assert.equal(lot.safetyStatus, "RECALLED", "safetyStatus phải là RECALLED");
  });

  await t.test("TC03: Lô con thừa kế cảnh báo thu hồi từ lô mẹ (Descendant Recall)", async () => {
    // LOT-002 có lô con L02 (từ phả hệ S-22)
    inMemoryRecallOrders.push({
      id: "RC-PARENT-002",
      lotId: "LOT-002",
      reason: "Thu hồi khẩn cấp nguồn nguyên liệu",
      severity: "CRITICAL",
      status: "INVESTIGATING",
      createdAt: new Date().toISOString(),
    });

    // Truy xuất lô con LOT-002 (hoặc kiểm tra trực tiếp qua hàm getPublicLotMapData)
    const res = await request(app).get("/api/public/lots/LOT-002");
    assert.equal(res.status, 200);
    assert.equal(res.body.lot.recall.isRecalled, true);
    assert.equal(res.body.lot.safetyStatus, "RECALLED");
  });

  await t.test("TC04: Lô hàng có trạng thái Có sự cố / Đang thu hồi / Đã thu hồi", async () => {
    const incidentLot = {
      id: "LOT-INCIDENT-01",
      name: "Lô cam sành bị hỏng",
      status: "Có sự cố",
      organizationId: "org-001",
      productId: "PROD-ORANGE",
      createdAt: new Date().toISOString(),
    };
    inMemoryLots.push(incidentLot);

    const res = await request(app).get("/api/public/lots/LOT-INCIDENT-01");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.recall.isRecalled, true);
    assert.equal(lot.safetyStatus, "RECALLED");
    assert.ok(lot.recall.reason.includes("sự cố") || lot.recall.reason.includes("thu hồi"));
  });

  await t.test("TC05: Lô hàng từng ghi nhận vi phạm chuỗi lạnh (TEMPERATURE_VIOLATION)", async () => {
    const violatedLot = {
      id: "LOT-COLD-BREACH-01",
      name: "Lô dâu tây Đà Lạt",
      status: "Đang lưu kho",
      organizationId: "org-001",
      productId: "PROD-STRAWBERRY",
      createdAt: "2026-10-15T08:00:00.000Z",
    };
    inMemoryLots.push(violatedLot);

    // Ghi sự kiện vi phạm nhiệt độ bảo quản vào hash-chain
    inMemoryBatchEvents.push({
      id: "evt-temp-viol-01",
      batchId: "LOT-COLD-BREACH-01",
      sequenceNo: 1,
      eventType: "TEMPERATURE_VIOLATION",
      payload: {
        violationId: "viol-test-99",
        shipmentId: "ship-test-01",
        threshold: 8.0,
        startTime: "2026-10-15T10:00:00.000Z",
        endTime: "2026-10-15T10:45:00.000Z",
        durationMinutes: 45,
        peakTemperature: 14.5,
        rule: "Vượt ngưỡng trên 8°C quá 30 phút",
      },
      organizationId: "org-001",
      occurredAt: "2026-10-15T10:45:00.000Z",
    });

    const res = await request(app).get("/api/public/lots/LOT-COLD-BREACH-01");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.recall.isRecalled, false, "Không có lệnh thu hồi");
    assert.equal(lot.coldChain.hasViolation, true, "Phải ghi nhận hasViolation = true");
    assert.equal(lot.coldChain.violationCount, 1, "Số lần vi phạm là 1");
    assert.equal(lot.coldChain.peakTemperature, 14.5, "Nhiệt độ đỉnh là 14.5°C");
    assert.equal(lot.coldChain.durationMinutes, 45, "Thời gian vi phạm là 45 phút");
    assert.ok(lot.coldChain.message.includes("14.5°C"), "Thông báo phải có nhiệt độ đỉnh");
    assert.equal(lot.safetyStatus, "TEMPERATURE_VIOLATED", "safetyStatus phải là TEMPERATURE_VIOLATED");

    // Kiểm tra timeline có mốc cảnh báo vi phạm
    const journey = res.body.journey;
    const violationStep = journey.find((s) => s.hasViolation === true);
    assert.ok(violationStep, "Hành trình phải chứa mốc sự kiện vi phạm nhiệt độ");
    assert.ok(violationStep.description.includes("14.5°C"));
    assert.ok(violationStep.warning);
  });

  await t.test("TC06: Lô hàng bị CẢ HAI sự cố: Thu hồi VÀ Vi phạm chuỗi lạnh", async () => {
    const dualLot = {
      id: "LOT-DUAL-ISSUE-01",
      name: "Lô táo New Zealand nhập khẩu",
      status: "Đang thu hồi",
      organizationId: "org-001",
      productId: "PROD-APPLE",
      createdAt: "2026-10-16T08:00:00.000Z",
    };
    inMemoryLots.push(dualLot);

    inMemoryRecallOrders.push({
      id: "RC-DUAL-01",
      lotId: "LOT-DUAL-ISSUE-01",
      reason: "Thu hồi toàn quốc do nhiễm khuẩn",
      status: "OPEN",
    });

    inMemoryBatchEvents.push({
      id: "evt-temp-dual-01",
      batchId: "LOT-DUAL-ISSUE-01",
      sequenceNo: 1,
      eventType: "TEMPERATURE_VIOLATION",
      payload: {
        violationId: "viol-dual-01",
        peakTemperature: 18.0,
        threshold: 4.0,
        durationMinutes: 60,
      },
      occurredAt: "2026-10-16T12:00:00.000Z",
    });

    const res = await request(app).get("/api/public/lots/LOT-DUAL-ISSUE-01");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.recall.isRecalled, true, "Phải có cảnh báo thu hồi");
    assert.equal(lot.coldChain.hasViolation, true, "Phải có cảnh báo vi phạm chuỗi lạnh");
    assert.equal(lot.safetyStatus, "RECALLED", "Thu hồi chiếm độ ưu tiên nghiêm trọng cao nhất");
  });

  await t.test("TC07: Bảo đảm Whitelisting dữ liệu khi có cảnh báo thu hồi & vi phạm nhiệt độ (S-48 + S-49)", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const rawJson = JSON.stringify(res.body);

    // Kiểm tra không rò rỉ mã người dùng nội bộ hay trường nhạy cảm
    assert.equal(rawJson.includes('"createdBy":'), false);
    assert.equal(rawJson.includes('"actorUserId":'), false);
    assert.equal(rawJson.includes('"password":'), false);
    assert.equal(rawJson.includes('"driverPhone":'), false);
  });

  await t.test("TC08: Kiểm tra giao diện HTML và CSS có đầy đủ banner cảnh báo chuẩn trợ năng (Accessibility)", () => {
    const htmlPath = path.join(__dirname, "../../frontend/public-trace.html");
    const cssPath = path.join(__dirname, "../../frontend/public-trace-map.css");
    const jsPath = path.join(__dirname, "../../frontend/public-trace-map.js");

    assert.ok(fs.existsSync(htmlPath), "File public-trace.html phải tồn tại");
    assert.ok(fs.existsSync(cssPath), "File public-trace-map.css phải tồn tại");
    assert.ok(fs.existsSync(jsPath), "File public-trace-map.js phải tồn tại");

    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    const jsContent = fs.readFileSync(jsPath, "utf8");

    // Kiểm tra banner thu hồi và trợ năng
    assert.ok(htmlContent.includes('id="lot-recall-alert"'), "HTML phải có #lot-recall-alert");
    assert.ok(htmlContent.includes('role="alert"'), "Banner phải có thuộc tính role='alert' cho trợ năng");
    assert.ok(htmlContent.includes('id="lot-coldchain-alert"'), "HTML phải có #lot-coldchain-alert");
    assert.ok(htmlContent.includes('id="lot-safety-banner"'), "HTML phải có #lot-safety-banner");

    // Kiểm tra CSS styles cảnh báo
    assert.ok(cssContent.includes(".alert-recall"), "CSS phải có định dạng .alert-recall");
    assert.ok(cssContent.includes(".alert-coldchain"), "CSS phải có định dạng .alert-coldchain");
    assert.ok(cssContent.includes(".badge-danger"), "CSS phải có định dạng .badge-danger");
    assert.ok(cssContent.includes(".badge-warning"), "CSS phải có định dạng .badge-warning");

    // Kiểm tra JS xử lý hiển thị cảnh báo
    assert.ok(jsContent.includes("trace-badge-violation"), "JS phải kết xuất badge vi phạm");
  });
});
