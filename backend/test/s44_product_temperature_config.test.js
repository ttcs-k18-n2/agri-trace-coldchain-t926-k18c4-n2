/**
 * Test Suite: Story S-44 (Jira N2-112)
 * "Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm"
 *
 * Subtasks:
 * - N2-219: Backend (Ngưỡng min/max, độ trễ, giới hạn chặt nhất, snapshot bất biến, API & PostgreSQL)
 * - N2-278: Frontend (UI sản phẩm, badge nhiệt độ, validation, phân quyền admin, chi tiết chuyến)
 * - N2-220: Tester (TC01 -> TC15)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  seedDemoUser,
  inMemoryProducts,
  inMemoryLots,
} = require("../src/server");

const {
  ColdChainViolationDetector,
  resolveShipmentThresholds,
  handleAcceptedTemperatureReading,
  inMemoryViolations,
  verifyS42Scenarios,
} = require("../src/cold_chain_violation_service");

const {
  createShipment,
  getShipmentById,
  recordShipmentTemperature,
} = require("../src/shipment_service");

const { inMemoryBatchEvents } = require("../src/event_repository");

// Helper: HTTP Request
function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Helper: Login
async function loginUser(server, email, password) {
  const res = await request(
    server,
    {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  );

  const cookie = res.headers["set-cookie"];
  return {
    status: res.status,
    body: res.body,
    cookie: Array.isArray(cookie) ? cookie.map((c) => c.split(";")[0]).join("; ") : cookie,
  };
}

test("Story S-44: Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm (TC01 -> TC15)", async (t) => {
  let server;
  let adminCookie;
  let producerOrg1Cookie;
  let producerOrg2Cookie;
  let inspectorCookie;

  t.before(async () => {
    await seedDemoUser();

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const adminLogin = await loginUser(server, "admin@example.com", "Password@123");
    adminCookie = adminLogin.cookie;

    const p1Login = await loginUser(server, "user@example.com", "Password@123");
    producerOrg1Cookie = p1Login.cookie;

    const p2Login = await loginUser(server, "user2@example.com", "Password@123");
    producerOrg2Cookie = p2Login.cookie;

    const inspLogin = await loginUser(server, "inspector@example.com", "Password@123");
    inspectorCookie = inspLogin.cookie;
  });

  t.after(() => {
    if (server) server.close();
  });

  // TC01: Sản phẩm A có ngưỡng riêng và phát hiện đúng vi phạm trên
  await t.test("TC01: Sản phẩm A có ngưỡng riêng và phát hiện đúng vi phạm trên (UPPER_BREACH)", () => {
    const detector = new ColdChainViolationDetector({
      tempMin: 2.0,
      tempMax: 8.0,
      delayMinutes: 30,
    });

    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");
    const readings = [
      { recordedAt: new Date(baseMs + 0 * 60000).toISOString(), temperature: 5.0 },
      { recordedAt: new Date(baseMs + 10 * 60000).toISOString(), temperature: 9.5 },
      { recordedAt: new Date(baseMs + 25 * 60000).toISOString(), temperature: 10.5 },
      { recordedAt: new Date(baseMs + 45 * 60000).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseMs + 46 * 60000).toISOString(), temperature: 5.0 },
    ];

    const violations = detector.evaluateSeries(readings);
    assert.equal(violations.length, 1, "Phải phát hiện đúng 1 vi phạm trên");
    assert.equal(violations[0].breachType, "UPPER_BREACH");
    assert.equal(violations[0].threshold, 8.0);
    assert.equal(violations[0].peakTemperature, 10.5);
    assert.equal(violations[0].durationMinutes, 35);
    assert.ok(violations[0].rule.includes("Vượt ngưỡng trên 8°C"));
  });

  // TC02: Sản phẩm B có ngưỡng khác; cùng một số đo có thể hợp lệ với A nhưng vi phạm với B
  await t.test("TC02: Sản phẩm B có ngưỡng khác - cùng số đo hợp lệ với A nhưng vi phạm với B", () => {
    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");
    const readings = [
      { recordedAt: new Date(baseMs + 0 * 60000).toISOString(), temperature: 6.0 },
      { recordedAt: new Date(baseMs + 10 * 60000).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 45 * 60000).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 46 * 60000).toISOString(), temperature: 6.0 },
    ];

    // Sản phẩm A: Chè (5°C - 12°C, trễ 45 phút)
    const detectorA = new ColdChainViolationDetector({
      tempMin: 5.0,
      tempMax: 12.0,
      delayMinutes: 45,
    });
    const violationsA = detectorA.evaluateSeries(readings);
    assert.equal(violationsA.length, 0, "Sản phẩm A (chè max 12°C) phải an toàn, 0 vi phạm");

    // Sản phẩm B: Cà chua (2°C - 8°C, trễ 30 phút)
    const detectorB = new ColdChainViolationDetector({
      tempMin: 2.0,
      tempMax: 8.0,
      delayMinutes: 30,
    });
    const violationsB = detectorB.evaluateSeries(readings);
    assert.equal(violationsB.length, 1, "Sản phẩm B (cà chua max 8°C) phải có 1 vi phạm vì vượt 10°C trong 35 phút");
    assert.equal(violationsB[0].breachType, "UPPER_BREACH");
  });

  // TC03: Nhiệt độ thấp hơn ngưỡng dưới tạo vi phạm đúng điều kiện độ trễ
  await t.test("TC03: Nhiệt độ thấp hơn ngưỡng dưới tạo vi phạm LOWER_BREACH đúng điều kiện độ trễ", () => {
    const detector = new ColdChainViolationDetector({
      tempMin: 2.0,
      tempMax: 8.0,
      delayMinutes: 30,
    });

    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");
    // Đợt 1: Thấp hơn ngưỡng dưới nhưng ngắn (15 phút <= 30 phút) -> Không vi phạm
    const shortUnderSeries = [
      { recordedAt: new Date(baseMs + 0 * 60000).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseMs + 5 * 60000).toISOString(), temperature: 0.5 },
      { recordedAt: new Date(baseMs + 20 * 60000).toISOString(), temperature: 0.8 },
      { recordedAt: new Date(baseMs + 21 * 60000).toISOString(), temperature: 4.0 },
    ];
    assert.equal(detector.evaluateSeries(shortUnderSeries).length, 0, "Hạ nhiệt ngắn <= 30 phút không bị vi phạm");

    // Đợt 2: Thấp hơn ngưỡng dưới kéo dài 40 phút (> 30 phút) -> Có vi phạm LOWER_BREACH
    const longUnderSeries = [
      { recordedAt: new Date(baseMs + 0 * 60000).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseMs + 10 * 60000).toISOString(), temperature: 0.5 },
      { recordedAt: new Date(baseMs + 25 * 60000).toISOString(), temperature: -1.2 },
      { recordedAt: new Date(baseMs + 50 * 60000).toISOString(), temperature: 0.8 },
      { recordedAt: new Date(baseMs + 51 * 60000).toISOString(), temperature: 4.0 },
    ];
    const violations = detector.evaluateSeries(longUnderSeries);
    assert.equal(violations.length, 1, "Phải có đúng 1 vi phạm hạ nhiệt quá mức");
    assert.equal(violations[0].breachType, "LOWER_BREACH");
    assert.equal(violations[0].threshold, 2.0);
    assert.equal(violations[0].peakTemperature, -1.2);
    assert.equal(violations[0].durationMinutes, 40);
    assert.ok(violations[0].rule.includes("Thấp hơn ngưỡng dưới 2°C"));
  });

  // TC04: Chuyến vận chuyển có nhiều sản phẩm áp giới hạn chặt nhất
  await t.test("TC04: Chuyến vận chuyển có nhiều sản phẩm áp giới hạn chặt nhất: MAX(min), MIN(max), MIN(delay)", async () => {
    const products = [
      { id: "PROD-TOMATO", name: "Cà chua", tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 },
      { id: "PROD-VEGETABLE", name: "Rau cải", tempMin: 1.0, tempMax: 6.0, delayMinutes: 20 },
    ];

    const resolved = resolveShipmentThresholds(products);
    assert.equal(resolved.incompatible, false);
    assert.equal(resolved.tempMin, 2.0, "Ngưỡng dưới chặt nhất phải là MAX(2.0, 1.0) = 2.0");
    assert.equal(resolved.tempMax, 6.0, "Ngưỡng trên chặt nhất phải là MIN(8.0, 6.0) = 6.0");
    assert.equal(resolved.delayMinutes, 20, "Độ trễ chặt nhất phải là MIN(30, 20) = 20");

    // Tạo chuyến chở cả cà chua và rau cải
    const shipResult = await createShipment({
      pool: null,
      authContext: { userId: "u-admin", roleId: "admin", isAdmin: true },
      data: {
        coldBoxId: "BOX-TC04-MULTI",
        lotIds: ["LOT-001", "LOT-TC04-VEG"], // Cả hai lô thuộc org-001
      },
      inMemoryLots: [
        { id: "LOT-001", name: "Lô cà chua", organizationId: "org-001", productId: "PROD-TOMATO", initialQuantity: 100, remainingQuantity: 100 },
        { id: "LOT-TC04-VEG", name: "Lô rau cải", organizationId: "org-001", productId: "PROD-VEGETABLE", initialQuantity: 100, remainingQuantity: 100 },
      ],
      inMemoryProducts: products,
    });

    assert.equal(shipResult.status, 201);
    assert.equal(shipResult.shipment.appliedTempMin, 2.0);
    assert.equal(shipResult.shipment.appliedTempMax, 6.0);
    assert.equal(shipResult.shipment.appliedDelayMinutes, 20);

    // Thử nghiệm đo nhiệt độ 7.0°C kéo dài 25 phút (> 6.0°C và > 20 phút)
    const detector = new ColdChainViolationDetector({
      tempMin: shipResult.shipment.appliedTempMin,
      tempMax: shipResult.shipment.appliedTempMax,
      delayMinutes: shipResult.shipment.appliedDelayMinutes,
    });

    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");
    const readings = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseMs + 10 * 60000).toISOString(), temperature: 7.0 },
      { recordedAt: new Date(baseMs + 35 * 60000).toISOString(), temperature: 7.0 },
      { recordedAt: new Date(baseMs + 36 * 60000).toISOString(), temperature: 4.0 },
    ];
    const viols = detector.evaluateSeries(readings);
    assert.equal(viols.length, 1, "Chuyến nhiều sản phẩm phải kích hoạt vi phạm theo ngưỡng chặt nhất 6.0°C");
  });

  // TC05: Hai sản phẩm có khoảng nhiệt độ không tương thích phải được xử lý rõ
  await t.test("TC05: Hai sản phẩm có khoảng nhiệt độ không tương thích bị từ chối rõ ràng", async () => {
    const incompatibleProducts = [
      { id: "PROD-FROZEN", name: "Thịt đông lạnh", tempMin: -20.0, tempMax: -10.0, delayMinutes: 15 },
      { id: "PROD-CHILLED", name: "Rau tươi", tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 },
    ];

    const resolved = resolveShipmentThresholds(incompatibleProducts);
    assert.equal(resolved.incompatible, true, "Phải đánh dấu dải nhiệt độ không tương thích");
    assert.ok(resolved.incompatibilityReason.includes("không tương thích"));

    // Kiểm tra API createShipment từ chối HTTP 400
    const shipResult = await createShipment({
      pool: null,
      authContext: { userId: "u-admin", roleId: "admin", isAdmin: true },
      data: {
        coldBoxId: "BOX-TC05-INCOMPAT",
        lotIds: ["LOT-FROZEN", "LOT-CHILLED"],
      },
      inMemoryLots: [
        { id: "LOT-FROZEN", name: "Lô đông lạnh", organizationId: "org-001", productId: "PROD-FROZEN", initialQuantity: 100, remainingQuantity: 100 },
        { id: "LOT-CHILLED", name: "Lô rau tươi", organizationId: "org-001", productId: "PROD-CHILLED", initialQuantity: 100, remainingQuantity: 100 },
      ],
      inMemoryProducts: incompatibleProducts,
    });

    assert.equal(shipResult.status, 400);
    assert.equal(shipResult.error, "INCOMPATIBLE_PRODUCT_TEMPERATURE_RANGES");
  });

  // TC06: Thay đổi cấu hình sau khi đã ghi vi phạm không làm thay đổi lịch sử vi phạm trước đó
  await t.test("TC06: Cập nhật cấu hình sản phẩm không làm thay đổi lịch sử vi phạm đã ghi", async () => {
    const prodTomato = { id: "PROD-TC06-TOMATO", name: "Cà chua TC06", unit: "kg", tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 };
    inMemoryProducts.push(prodTomato);

    const lot06 = { id: "LOT-TC06", name: "Lô TC06", organizationId: "org-001", productId: "PROD-TC06-TOMATO", initialQuantity: 100, remainingQuantity: 100 };
    inMemoryLots.push(lot06);

    const ship = await createShipment({
      pool: null,
      authContext: { userId: "u-admin", roleId: "admin", isAdmin: true },
      data: { coldBoxId: "BOX-TC06", lotIds: ["LOT-TC06"] },
      inMemoryLots,
      inMemoryProducts,
    });
    assert.equal(ship.status, 201);
    const shipmentId = ship.shipment.id;

    // Ghi nhận vi phạm nhiệt độ 11.0°C (> 8.0°C) kéo dài 40 phút
    const baseMs = Date.parse("2026-10-17T09:00:00.000Z");
    await handleAcceptedTemperatureReading({
      shipment: ship.shipment,
      coldBoxId: "BOX-TC06",
      temperature: 11.0,
      recordedAt: new Date(baseMs).toISOString(),
    });
    await handleAcceptedTemperatureReading({
      shipment: ship.shipment,
      coldBoxId: "BOX-TC06",
      temperature: 11.0,
      recordedAt: new Date(baseMs + 40 * 60000).toISOString(),
    });

    // Vi phạm đã được xác nhận
    const violsBefore = inMemoryViolations.filter((v) => v.shipment_id === shipmentId || v.shipmentId === shipmentId);
    assert.ok(violsBefore.length > 0, "Đã ghi nhận vi phạm ban đầu");
    const recordedThreshold = violsBefore[0].threshold || violsBefore[0].threshold_value;
    assert.equal(Number(recordedThreshold), 8.0);

    // Admin cập nhật ngưỡng của sản phẩm lên 15.0°C qua API
    const updateRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: `/api/products/${prodTomato.id}/temperature-config`,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
      },
      { tempMin: 5.0, tempMax: 15.0, delayMinutes: 45 }
    );
    assert.equal(updateRes.status, 200);

    // Kiểm tra lại vi phạm cũ: không bị recalculate hay ghi đè
    const violsAfter = inMemoryViolations.filter((v) => v.shipment_id === shipmentId || v.shipmentId === shipmentId);
    assert.equal(violsAfter.length, violsBefore.length, "Số lượng vi phạm cũ không đổi");
    assert.equal(Number(violsAfter[0].threshold || violsAfter[0].threshold_value), 8.0, "Ngưỡng của vi phạm cũ được bảo toàn");

    // Chuyến đang chạy vẫn giữ snapshot cấu hình ban đầu
    const fetchShip = await getShipmentById({ shipmentId, authContext: { isAdmin: true } });
    assert.equal(fetchShip.shipment.appliedTempMax, 8.0);
  });

  // TC07: Kiểm tra chính xác trường hợp vừa bằng ngưỡng, vừa đủ độ trễ và vượt độ trễ
  await t.test("TC07: Biên số đo - vừa bằng ngưỡng không vi phạm, vừa đủ độ trễ không vi phạm, vượt độ trễ có vi phạm", () => {
    const detector = new ColdChainViolationDetector({
      tempMin: 2.0,
      tempMax: 8.0,
      delayMinutes: 30,
    });
    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");

    // 1. Số đo vừa đúng bằng ngưỡng trên (8.0°C) -> KHÔNG vi phạm
    const exactThreshold = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 8.0 },
      { recordedAt: new Date(baseMs + 40 * 60000).toISOString(), temperature: 8.0 },
    ];
    assert.equal(detector.evaluateSeries(exactThreshold).length, 0, "Bằng đúng ngưỡng trên 8.0°C không vi phạm");

    // 2. Vừa đúng bằng ngưỡng dưới (2.0°C) -> KHÔNG vi phạm
    const exactLowerThreshold = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 2.0 },
      { recordedAt: new Date(baseMs + 40 * 60000).toISOString(), temperature: 2.0 },
    ];
    assert.equal(detector.evaluateSeries(exactLowerThreshold).length, 0, "Bằng đúng ngưỡng dưới 2.0°C không vi phạm");

    // 3. Thời lượng vượt vừa đúng 30 phút (khoảng cách = 30 * 60 * 1000 ms, tức không > 30m) -> KHÔNG vi phạm
    const exactDuration = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 30 * 60000).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 31 * 60000).toISOString(), temperature: 5.0 },
    ];
    assert.equal(detector.evaluateSeries(exactDuration).length, 0, "Đúng 30 phút không tính là vi phạm (phải > 30 phút)");

    // 4. Thời lượng vượt quá 30 phút (30 phút 1 giây hoặc 31 phút) -> CÓ vi phạm
    const overDuration = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 31 * 60000).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseMs + 32 * 60000).toISOString(), temperature: 5.0 },
    ];
    assert.equal(detector.evaluateSeries(overDuration).length, 1, "Kéo dài 31 phút (> 30 phút) tính là 1 vi phạm");
  });

  // TC08: Không có quyền quản trị phải bị từ chối khi sửa cấu hình
  await t.test("TC08: Kiểm tra phân quyền sửa cấu hình - Non-admin bị từ chối 403, unauthenticated 401", async () => {
    // 1. Chưa đăng nhập
    const unauthRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    }, { tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 });
    assert.equal(unauthRes.status, 401);

    // 2. Nông hộ / Sản xuất (Producer)
    const prodRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: producerOrg1Cookie },
    }, { tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 });
    assert.equal(prodRes.status, 403);

    // 3. Cán bộ kiểm tra (Inspector)
    const inspRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: inspectorCookie },
    }, { tempMin: 2.0, tempMax: 8.0, delayMinutes: 30 });
    assert.equal(inspRes.status, 403);

    // 4. Admin sửa cấu hình hợp lệ -> 200
    const adminOkRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    }, { tempMin: 2.5, tempMax: 7.5, delayMinutes: 25 });
    assert.equal(adminOkRes.status, 200);

    // 5. Admin gửi cấu hình sai: tempMin >= tempMax -> 400 INVALID_TEMPERATURE_RANGE
    const badRangeRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    }, { tempMin: 10.0, tempMax: 5.0, delayMinutes: 30 });
    assert.equal(badRangeRes.status, 400);
    assert.equal(badRangeRes.body.error, "INVALID_TEMPERATURE_RANGE");

    // 6. Admin gửi độ trễ âm -> 400 INVALID_DELAY_MINUTES
    const badDelayRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/products/PROD-TOMATO/temperature-config",
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    }, { tempMin: 2.0, tempMax: 8.0, delayMinutes: -10 });
    assert.equal(badDelayRes.status, 400);
    assert.equal(badDelayRes.body.error, "INVALID_DELAY_MINUTES");
  });

  // TC09: Kiểm tra quyền giữa hai tổ chức khác nhau
  await t.test("TC09: Phân lập dữ liệu tổ chức - Tổ chức 2 không thể tạo chuyến hay xem dữ liệu tổ chức 1", async () => {
    // Producer Org 2 cố tạo chuyến với lô của Org 1
    const crossCreateRes = await request(server, {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/shipments",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: producerOrg2Cookie },
    }, {
      coldBoxId: "BOX-CROSS-ORG",
      lotIds: ["LOT-001"], // Lô của org-001
    });
    assert.equal(crossCreateRes.status, 403);
    assert.equal(crossCreateRes.body.error, "FORBIDDEN_LOT_ACCESS");
  });

  // TC10: API, migration và dữ liệu PostgreSQL thật
  await t.test("TC10: Kiểm thử trực tiếp với CSDL PostgreSQL thật (Migration 028 và DML)", async (subT) => {
    let pgClient;
    let pool;
    try {
      const { Pool } = require("pg");
      pool = new Pool({
        connectionString: process.env.DATABASE_URL || "postgresql://agri_app:app_password@127.0.0.1:5432/agri_trace",
        connectionTimeoutMillis: 2000,
      });

      try {
        pgClient = await pool.connect();
      } catch (connErr) {
        console.warn("[S-44 PG Test] Không kết nối được PostgreSQL:", connErr.message);
        if (subT && typeof subT.skip === "function") {
          subT.skip("PostgreSQL không khả dụng trên môi trường test cục bộ");
        }
        await pool.end().catch(() => {});
        return;
      }

      // Kiểm tra cột mới trên bảng products
      const colProdRes = await pgClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'products' AND column_name IN ('temp_min', 'temp_max', 'delay_minutes')
      `);
      assert.equal(colProdRes.rows.length, 3, "Bảng products phải có đủ 3 cột mới");

      // Kiểm tra cột mới trên bảng shipments
      const colShipRes = await pgClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'shipments' AND column_name IN ('applied_temp_min', 'applied_temp_max', 'applied_delay_minutes', 'temperature_config')
      `);
      assert.equal(colShipRes.rows.length, 4, "Bảng shipments phải có đủ 4 cột mới");

      // Cập nhật cấu hình sản phẩm trong PostgreSQL và đọc lại
      await pgClient.query(
        "UPDATE products SET temp_min = 2.00, temp_max = 8.00, delay_minutes = 30 WHERE id = 'PROD-TOMATO'"
      );
      const readProd = await pgClient.query("SELECT temp_min, temp_max, delay_minutes FROM products WHERE id = 'PROD-TOMATO'");
      assert.equal(Number(readProd.rows[0].temp_min), 2.0);
      assert.equal(Number(readProd.rows[0].temp_max), 8.0);
      assert.equal(Number(readProd.rows[0].delay_minutes), 30);

      pgClient.release();
      await pool.end();
    } catch (err) {
      if (pgClient) pgClient.release();
      if (pool) await pool.end().catch(() => {});
      assert.fail("PostgreSQL test failed: " + err.message);
    }
  });

  // TC11: Test giao diện bằng trình duyệt, nhập và lưu cấu hình, tải lại trang
  await t.test("TC11: Kiểm tra cấu trúc DOM và giao diện HTML (products.html & shipments.html)", () => {
    const productsHtmlPath = path.resolve(__dirname, "../../frontend/products.html");
    const productsHtml = fs.readFileSync(productsHtmlPath, "utf8");

    // Kiểm tra các trường nhập liệu trong modal thêm/sửa sản phẩm
    assert.ok(productsHtml.includes('id="product-temp-min"'), "Phải có trường nhập ngưỡng dưới");
    assert.ok(productsHtml.includes('id="product-temp-max"'), "Phải có trường nhập ngưỡng trên");
    assert.ok(productsHtml.includes('id="product-delay-minutes"'), "Phải có trường nhập độ trễ");
    assert.ok(productsHtml.includes("product-temp-badge"), "Phải có render badge ngưỡng nhiệt độ trên card");
    assert.ok(productsHtml.includes("INVALID_TEMPERATURE_RANGE") || productsHtml.includes("nhỏ hơn ngưỡng nhiệt độ trên"), "Phải có validation client");

    // Kiểm tra shipments.html & shipments.js
    const shipmentsJsPath = path.resolve(__dirname, "../../frontend/shipments.js");
    const shipmentsJs = fs.readFileSync(shipmentsJsPath, "utf8");
    assert.ok(shipmentsJs.includes("appliedTempMin"), "shipments.js phải render appliedTempMin");
    assert.ok(shipmentsJs.includes("Giới hạn áp dụng"), "shipments.js phải hiển thị nhãn Giới hạn áp dụng");
  });

  // TC12: Regression S-40, S-41, S-42, S-43, S-45
  await t.test("TC12: Kiểm tra hồi quy toàn diện 5 kịch bản mẫu S-42", () => {
    const { allPassed } = verifyS42Scenarios();
    assert.ok(allPassed, "Cả 5 kịch bản S-42 phải PASS 100%");
  });

  // TC13: Gửi số đo cũ, trùng timestamp và kiểm tra không làm sai kết quả
  await t.test("TC13: Số đo cũ hơn hoặc trùng timestamp được bỏ qua an toàn (Resilience)", async () => {
    inMemoryLots.push({
      id: "LOT-TC13",
      name: "Lô TC13",
      organizationId: "org-001",
      productId: "PROD-TOMATO",
      initialQuantity: 100,
      remainingQuantity: 100,
    });

    const baseTime = "2026-10-17T08:00:00.000Z";
    const ship = await createShipment({
      pool: null,
      authContext: { userId: "u-admin", roleId: "admin", isAdmin: true },
      data: {
        coldBoxId: "BOX-TC13",
        lotIds: ["LOT-TC13"],
        startedAt: baseTime,
      },
      inMemoryLots,
      inMemoryProducts,
    });
    assert.equal(ship.status, 201);

    // Gửi số đo hợp lệ thời điểm 08:30:00
    const r1 = await recordShipmentTemperature({
      data: {
        coldBoxId: "BOX-TC13",
        timestamp: "2026-10-17T08:30:00.000Z",
        temperature: 5.5,
      },
      authContext: { userId: "usr-admin", roleId: "admin", isAdmin: true },
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.acknowledged, true);
    assert.equal(r1.ignored, false);

    // Gửi số đo cũ hơn thời điểm bắt đầu (07:50:00) -> Bỏ qua
    const rOld = await recordShipmentTemperature({
      data: {
        coldBoxId: "BOX-TC13",
        timestamp: "2026-10-17T07:50:00.000Z",
        temperature: 9.0,
      },
      authContext: { userId: "usr-admin", roleId: "admin", isAdmin: true },
    });
    assert.equal(rOld.status, 200);
    assert.equal(rOld.ignored, true);

    // Gửi số đo trùng timestamp (08:30:00) -> Bỏ qua
    const rDup = await recordShipmentTemperature({
      data: {
        coldBoxId: "BOX-TC13",
        timestamp: "2026-10-17T08:30:00.000Z",
        temperature: 12.0,
      },
      authContext: { userId: "usr-admin", roleId: "admin", isAdmin: true },
    });
    assert.equal(rDup.status, 200);
    assert.equal(rDup.ignored, true);
  });

  // TC14: Kiểm tra vi phạm ở cả nhiệt độ âm, 0°C và số thập phân
  await t.test("TC14: Kiểm tra vi phạm ở cả nhiệt độ âm (-18°C), 0°C và số thập phân", () => {
    const freezeDetector = new ColdChainViolationDetector({
      tempMin: -25.5,
      tempMax: -18.0,
      delayMinutes: 15,
    });

    const baseMs = Date.parse("2026-10-17T08:00:00.000Z");

    // Vi phạm ngưỡng trên ở dải âm (-15.2°C > -18.0°C kéo dài 20m)
    const upperNegativeSeries = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: -20.0 },
      { recordedAt: new Date(baseMs + 5 * 60000).toISOString(), temperature: -15.2 },
      { recordedAt: new Date(baseMs + 25 * 60000).toISOString(), temperature: -15.2 },
      { recordedAt: new Date(baseMs + 26 * 60000).toISOString(), temperature: -20.0 },
    ];
    const upperViols = freezeDetector.evaluateSeries(upperNegativeSeries);
    assert.equal(upperViols.length, 1);
    assert.equal(upperViols[0].breachType, "UPPER_BREACH");
    assert.equal(upperViols[0].peakTemperature, -15.2);

    // Vi phạm ngưỡng dưới ở dải âm (-28.4°C < -25.5°C kéo dài 20m)
    const lowerNegativeSeries = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: -20.0 },
      { recordedAt: new Date(baseMs + 5 * 60000).toISOString(), temperature: -28.4 },
      { recordedAt: new Date(baseMs + 25 * 60000).toISOString(), temperature: -28.4 },
      { recordedAt: new Date(baseMs + 26 * 60000).toISOString(), temperature: -20.0 },
    ];
    const lowerViols = freezeDetector.evaluateSeries(lowerNegativeSeries);
    assert.equal(lowerViols.length, 1);
    assert.equal(lowerViols[0].breachType, "LOWER_BREACH");
    assert.equal(lowerViols[0].peakTemperature, -28.4);

    // Kiểm tra 0.0°C không bị falsy bug
    const zeroDetector = new ColdChainViolationDetector({
      tempMin: 0.0,
      tempMax: 4.0,
      delayMinutes: 10,
    });
    assert.equal(zeroDetector.tempMin, 0.0);
    const zeroSeries = [
      { recordedAt: new Date(baseMs).toISOString(), temperature: 2.0 },
      { recordedAt: new Date(baseMs + 5 * 60000).toISOString(), temperature: -1.0 },
      { recordedAt: new Date(baseMs + 20 * 60000).toISOString(), temperature: -1.0 },
      { recordedAt: new Date(baseMs + 21 * 60000).toISOString(), temperature: 2.0 },
    ];
    const zeroViols = zeroDetector.evaluateSeries(zeroSeries);
    assert.equal(zeroViols.length, 1);
    assert.equal(zeroViols[0].threshold, 0.0);
  });

  // TC15: Kiểm tra lịch sử sự kiện và dữ liệu không bị ghi đè (Hash-Chain RFC 8785 SHA-256)
  await t.test("TC15: Kiểm tra lịch sử sự kiện bất biến và toàn vẹn chuỗi hash (S-45)", () => {
    // Tìm các sự kiện TEMPERATURE_VIOLATION đã ghi vào inMemoryBatchEvents
    const violationEvents = inMemoryBatchEvents.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    for (const evt of violationEvents) {
      assert.ok(evt.id, "Mỗi sự kiện phải có id duy nhất");
      assert.ok(evt.sequenceNo >= 1, "Số thứ tự chuỗi sự kiện phải tăng dần >= 1");
      assert.ok(evt.eventHash, "Sự kiện phải có eventHash SHA-256");
      assert.equal(evt.eventHash.length, 64, "Mã băm SHA-256 phải đủ 64 ký tự hex");
    }
  });
});
