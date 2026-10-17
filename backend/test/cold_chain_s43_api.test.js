const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  seedDemoUser,
  inMemoryReadings,
  inMemoryViolations,
  streamingDetectors,
} = require("../src/server");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Đăng nhập thất bại cho ${email}: ${res.body?.message}`);
  return agent;
}

test.beforeEach(async () => {
  users.clear();
  inMemoryReadings.length = 0;
  inMemoryViolations.length = 0;
  streamingDetectors.clear();
  await seedDemoUser();
});

test("Story S-43: REST API Integration & Permission Matrix", async (t) => {
  await t.test("POST /api/cold-chain/readings: Kiểm tra xác thực và validation đầu vào", async () => {
    // 1. Chưa đăng nhập -> 401
    const unauthRes = await request(app).post("/api/cold-chain/readings").send({
      coldBoxId: "CBX-001",
      temperature: 10.5,
    });
    assert.equal(unauthRes.status, 401);

    // 2. Transporter đăng nhập hợp lệ
    const transporterAgent = await loginAs("transporter@example.com");

    // Thiếu coldBoxId -> 400 MISSING_COLD_BOX_ID
    const noBox = await transporterAgent.post("/api/cold-chain/readings").send({
      temperature: 10.5,
    });
    assert.equal(noBox.status, 400);
    assert.equal(noBox.body.error, "MISSING_COLD_BOX_ID");

    // Nhiệt độ không hợp lệ -> 400 INVALID_TEMPERATURE
    const badTemp = await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: "CBX-001",
      temperature: "not-a-number",
    });
    assert.equal(badTemp.status, 400);
    assert.equal(badTemp.body.error, "INVALID_TEMPERATURE");

    // Hợp lệ -> 201 Created
    const validRes = await transporterAgent.post("/api/cold-chain/readings").send({
      shipmentId: "shp-test-01",
      coldBoxId: "CBX-001",
      temperature: 12.5,
      humidity: 85,
      recordedAt: new Date().toISOString(),
    });
    assert.equal(validRes.status, 201);
    assert.ok(validRes.body.success);
    assert.equal(validRes.body.reading.cold_box_id, "CBX-001");
    assert.equal(validRes.body.reading.temperature, 12.5);
  });

  await t.test("POST /api/cold-chain/evaluate: Đánh giá chuỗi nhiệt độ theo yêu cầu (On-Demand Evaluation)", async () => {
    const inspectorAgent = await loginAs("inspector@example.com");
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();

    // Gửi chuỗi số đo hỏng lạnh kéo dài 45 phút (> 30 phút)
    const payload = {
      threshold: 8.0,
      minDurationMinutes: 30,
      readings: [
        { recordedAt: new Date(baseTime).toISOString(), temperature: 4.0 },
        { recordedAt: new Date(baseTime + 10 * 60 * 1000).toISOString(), temperature: 9.5 },
        { recordedAt: new Date(baseTime + 25 * 60 * 1000).toISOString(), temperature: 13.8 }, // Đỉnh
        { recordedAt: new Date(baseTime + 55 * 60 * 1000).toISOString(), temperature: 8.6 },
        { recordedAt: new Date(baseTime + 56 * 60 * 1000).toISOString(), temperature: 4.5 },
      ],
    };

    const res = await inspectorAgent.post("/api/cold-chain/evaluate").send(payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.violationsCount, 1);
    assert.equal(res.body.violations[0].peakTemperature, 13.8);
    assert.equal(res.body.violations[0].durationMinutes, 45);
  });

  await t.test("GET /api/cold-chain/scenarios & POST /api/cold-chain/scenarios/verify: 5 Kịch bản S-42", async () => {
    const inspectorAgent = await loginAs("inspector@example.com");

    // Lấy danh sách 5 kịch bản
    const getRes = await inspectorAgent.get("/api/cold-chain/scenarios");
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.scenarios.length, 5);

    // Chạy kiểm chứng toàn bộ 5 kịch bản qua API
    const verifyRes = await inspectorAgent.post("/api/cold-chain/scenarios/verify").send({});
    assert.equal(verifyRes.status, 200);
    assert.ok(verifyRes.body.allPassed, "Toàn bộ 5 kịch bản phải pass 100%");
    assert.equal(verifyRes.body.results.scenario1.actualViolationsCount, 0);
    assert.equal(verifyRes.body.results.scenario2.actualViolationsCount, 1);
    assert.equal(verifyRes.body.results.scenario3.actualViolationsCount, 1);
    assert.equal(verifyRes.body.results.scenario4.actualViolationsCount, 2);
    assert.equal(verifyRes.body.results.scenario5.actualViolationsCount, 1);
  });

  await t.test("Phân quyền vai trò: Cán bộ kiểm tra (Inspector) chỉ được đọc vi phạm/số đo, không được ghi trực tiếp", async () => {
    const inspectorAgent = await loginAs("inspector@example.com");

    // Cán bộ kiểm tra ghi số đo -> 403 (chỉ có quyền đọc)
    const writeRes = await inspectorAgent.post("/api/cold-chain/readings").send({
      coldBoxId: "CBX-001",
      temperature: 15.0,
    });
    assert.equal(writeRes.status, 403);
    assert.match(writeRes.body.message, /chỉ có quyền đọc/i);

    // Cán bộ kiểm tra đọc danh sách vi phạm -> 200 OK
    const readViolations = await inspectorAgent.get("/api/cold-chain/violations");
    assert.equal(readViolations.status, 200);
    assert.ok(Array.isArray(readViolations.body.violations));

    // Cán bộ kiểm tra đọc danh sách số đo -> 200 OK
    const readReadings = await inspectorAgent.get("/api/cold-chain/readings");
    assert.equal(readReadings.status, 200);
    assert.ok(Array.isArray(readReadings.body.readings));
  });

  await t.test("Streaming Simulator qua API: Bắn số đo từng điểm và phát hiện vi phạm tự động khi qua 30 phút", async () => {
    const transporterAgent = await loginAs("transporter@example.com");
    const inspectorAgent = await loginAs("inspector@example.com");
    const baseTime = new Date("2026-10-17T09:00:00.000Z").getTime();
    const testBoxId = "CBX-STREAM-01";

    // Gửi điểm phút 0: 4°C (Bình thường)
    await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 4.0,
      recordedAt: new Date(baseTime).toISOString(),
    });

    // Gửi điểm phút 10: 9.0°C (Bắt đầu vượt ngưỡng)
    await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 9.0,
      recordedAt: new Date(baseTime + 10 * 60 * 1000).toISOString(),
    });

    // Gửi điểm phút 25: 12.0°C (Đang vượt 15 phút, chưa quá 30 phút -> chưa thành vi phạm)
    const midRes = await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 12.0,
      recordedAt: new Date(baseTime + 25 * 60 * 1000).toISOString(),
    });
    assert.equal(midRes.body.streamingAnalysis.activeExcursion.isOver30Min, false);

    // Gửi điểm phút 55: 14.0°C (Đã kéo dài 45 phút > 30 phút -> Đạt điều kiện vi phạm)
    const overRes = await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 14.0,
      recordedAt: new Date(baseTime + 55 * 60 * 1000).toISOString(),
    });
    assert.equal(overRes.body.streamingAnalysis.activeExcursion.isOver30Min, true);

    // Gửi điểm phút 65: 4.0°C (Về an toàn, đóng đợt vượt)
    await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 4.0,
      recordedAt: new Date(baseTime + 65 * 60 * 1000).toISOString(),
    });

    // Gửi điểm phút 75: 4.0°C (Qua 10 phút an toàn > 5 phút -> Chắc chắn finalize)
    await transporterAgent.post("/api/cold-chain/readings").send({
      coldBoxId: testBoxId,
      temperature: 4.0,
      recordedAt: new Date(baseTime + 75 * 60 * 1000).toISOString(),
    });

    // Cán bộ kiểm tra đọc danh sách vi phạm cho thùng lạnh này
    const violationsRes = await inspectorAgent.get(`/api/cold-chain/violations?coldBoxId=${testBoxId}`);
    assert.equal(violationsRes.status, 200);
    assert.equal(violationsRes.body.violations.length, 1);
    assert.equal(violationsRes.body.violations[0].peakTemperature, 14.0);
    assert.equal(violationsRes.body.violations[0].durationMinutes, 45);
  });
});
