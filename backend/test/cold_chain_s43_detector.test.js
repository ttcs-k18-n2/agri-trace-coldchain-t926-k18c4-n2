const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ColdChainViolationDetector,
  S42_SCENARIOS,
  buildScenarioReadings,
  verifyS42Scenarios,
} = require("../src/cold_chain_violation_service");

test("Story S-43: Acceptance Criteria & Algorithmic Verification", async (t) => {
  await t.test("AC1: Nhiệt độ vượt ngưỡng liên tục quá 30 phút thì sinh một vi phạm có đủ start, end, peak", () => {
    const detector = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30 });
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();

    // Chuỗi số đo 45 phút trên ngưỡng 8°C (từ phút 0 đến phút 45)
    const readings = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 8.5 },
      { recordedAt: new Date(baseTime + 15 * 60 * 1000).toISOString(), temperature: 12.0 },
      { recordedAt: new Date(baseTime + 30 * 60 * 1000).toISOString(), temperature: 14.8 }, // Đỉnh
      { recordedAt: new Date(baseTime + 45 * 60 * 1000).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 46 * 60 * 1000).toISOString(), temperature: 6.0 }, // Về an toàn
    ];

    const violations = detector.evaluateSeries(readings);
    assert.equal(violations.length, 1, "Phải sinh đúng 1 vi phạm");

    const v = violations[0];
    assert.equal(v.startTime, new Date(baseTime).toISOString(), "Thời điểm bắt đầu phải là phút 0");
    assert.equal(v.endTime, new Date(baseTime + 45 * 60 * 1000).toISOString(), "Thời điểm kết thúc đợt vượt là phút 45");
    assert.equal(v.peakTemperature, 14.8, "Nhiệt độ đỉnh phải là 14.8°C");
    assert.equal(v.durationMinutes, 45, "Thời lượng vi phạm phải là 45 phút");
  });

  await t.test("AC2: Vượt ngắn (<= 30 phút) rồi trở lại bình thường thì không tính là vi phạm", () => {
    const detector = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30 });
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();

    // Mở cửa xe trong 15 phút (vượt ngưỡng từ phút 5 đến phút 20)
    const readings = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseTime + 5 * 60 * 1000).toISOString(), temperature: 9.5 },
      { recordedAt: new Date(baseTime + 12 * 60 * 1000).toISOString(), temperature: 11.0 },
      { recordedAt: new Date(baseTime + 20 * 60 * 1000).toISOString(), temperature: 8.5 },
      { recordedAt: new Date(baseTime + 22 * 60 * 1000).toISOString(), temperature: 4.5 }, // Trở lại an toàn
      { recordedAt: new Date(baseTime + 60 * 60 * 1000).toISOString(), temperature: 4.0 },
    ];

    const violations = detector.evaluateSeries(readings);
    assert.equal(violations.length, 0, "Không được tính là vi phạm khi chỉ mở cửa ngắn <= 30 phút");
  });

  await t.test("AC3: Hai lần vượt cách nhau dưới 5 phút tính là một vi phạm (Gộp)", () => {
    const detector = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30, mergeGapMinutes: 5 });
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();

    // Lần 1: phút 10 -> phút 30 (20 phút, đỉnh 10.0)
    // Nghỉ 3 phút (< 5 phút): phút 31 -> phút 33 nhiệt độ 6°C
    // Lần 2: phút 34 -> phút 55 (21 phút, đỉnh 12.5)
    // Sau đó về an toàn
    const readings = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseTime + 10 * 60 * 1000).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 20 * 60 * 1000).toISOString(), temperature: 10.0 }, // Đỉnh lần 1
      { recordedAt: new Date(baseTime + 30 * 60 * 1000).toISOString(), temperature: 8.5 },
      { recordedAt: new Date(baseTime + 31 * 60 * 1000).toISOString(), temperature: 6.0 }, // Nghỉ
      { recordedAt: new Date(baseTime + 33 * 60 * 1000).toISOString(), temperature: 6.2 },
      { recordedAt: new Date(baseTime + 34 * 60 * 1000).toISOString(), temperature: 9.2 }, // Lần 2 bắt đầu
      { recordedAt: new Date(baseTime + 45 * 60 * 1000).toISOString(), temperature: 12.5 }, // Đỉnh lần 2
      { recordedAt: new Date(baseTime + 55 * 60 * 1000).toISOString(), temperature: 8.7 },
      { recordedAt: new Date(baseTime + 56 * 60 * 1000).toISOString(), temperature: 4.0 },
    ];

    const violations = detector.evaluateSeries(readings);
    assert.equal(violations.length, 1, "Khoảng cách 4 phút (< 5 phút) phải gộp thành đúng 1 vi phạm duy nhất");

    const v = violations[0];
    assert.equal(v.startTime, new Date(baseTime + 10 * 60 * 1000).toISOString(), "Start time phải là từ đầu lần 1");
    assert.equal(v.endTime, new Date(baseTime + 55 * 60 * 1000).toISOString(), "End time phải là cuối lần 2");
    assert.equal(v.peakTemperature, 12.5, "Đỉnh gộp phải là max(10.0, 12.5) = 12.5°C");
    assert.equal(v.excursionsCount, 2, "Ghi nhận 2 đợt đã gộp");
    assert.equal(v.durationMinutes, 45, "Tổng thời gian từ đầu lần 1 đến cuối lần 2 là 45 phút");
  });

  await t.test("AC4: Hai lần vượt cách nhau từ 5 phút trở lên tính là hai vi phạm riêng biệt (Không gộp)", () => {
    const detector = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30, mergeGapMinutes: 5 });
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();

    // Lần 1: phút 10 -> phút 50 (40 phút > 30 phút, đỉnh 13.0)
    // Khoảng nghỉ: phút 51 -> phút 70 (20 phút >= 5 phút)
    // Lần 2: phút 71 -> phút 106 (35 phút > 30 phút, đỉnh 12.0)
    const readings = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 4.0 },
      // Đợt 1
      { recordedAt: new Date(baseTime + 10 * 60 * 1000).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 30 * 60 * 1000).toISOString(), temperature: 13.0 },
      { recordedAt: new Date(baseTime + 50 * 60 * 1000).toISOString(), temperature: 8.5 },
      // Nghỉ an toàn 20 phút
      { recordedAt: new Date(baseTime + 52 * 60 * 1000).toISOString(), temperature: 4.0 },
      { recordedAt: new Date(baseTime + 65 * 60 * 1000).toISOString(), temperature: 4.2 },
      // Đợt 2
      { recordedAt: new Date(baseTime + 71 * 60 * 1000).toISOString(), temperature: 9.5 },
      { recordedAt: new Date(baseTime + 90 * 60 * 1000).toISOString(), temperature: 12.0 },
      { recordedAt: new Date(baseTime + 106 * 60 * 1000).toISOString(), temperature: 8.8 },
      { recordedAt: new Date(baseTime + 108 * 60 * 1000).toISOString(), temperature: 4.0 },
    ];

    const violations = detector.evaluateSeries(readings);
    assert.equal(violations.length, 2, "Khoảng cách 21 phút (>= 5 phút) không được gộp, phải sinh 2 vi phạm");

    assert.equal(violations[0].startTime, new Date(baseTime + 10 * 60 * 1000).toISOString());
    assert.equal(violations[0].peakTemperature, 13.0);
    assert.equal(violations[0].durationMinutes, 40);

    assert.equal(violations[1].startTime, new Date(baseTime + 71 * 60 * 1000).toISOString());
    assert.equal(violations[1].peakTemperature, 12.0);
    assert.equal(violations[1].durationMinutes, 35);
  });

  await t.test("AC5: Đối chiếu chuẩn xác 100% kết quả của cả 5 kịch bản mẫu ở S-42", () => {
    const { allPassed, results } = verifyS42Scenarios();
    assert.ok(allPassed, "Tất cả 5 kịch bản của S-42 phải PASS 100%");

    // Chi tiết kiểm tra từng kịch bản
    assert.equal(results.scenario1.actualViolationsCount, 0, "Kịch bản 1 phải có 0 vi phạm");
    assert.equal(results.scenario2.actualViolationsCount, 1, "Kịch bản 2 phải có đúng 1 vi phạm");
    assert.equal(results.scenario3.actualViolationsCount, 1, "Kịch bản 3 phải gộp thành đúng 1 vi phạm");
    assert.equal(results.scenario4.actualViolationsCount, 2, "Kịch bản 4 phải có 2 vi phạm riêng biệt");
    assert.equal(results.scenario5.actualViolationsCount, 1, "Kịch bản 5 chỉ có 1 vi phạm (bỏ qua đợt ngắn)");

    // Đỉnh nhiệt độ và thời lượng của kịch bản 3 (gộp)
    assert.equal(results.scenario3.violations[0].peakTemperature, 11.8);
    assert.equal(results.scenario3.violations[0].durationMinutes, 45);
    assert.equal(results.scenario3.violations[0].excursionsCount, 2);

    // Kịch bản 5: Đợt ngắn 15 phút bị bỏ qua, chỉ ghi nhận đợt dài 50 phút
    assert.equal(results.scenario5.violations[0].peakTemperature, 15.0);
    assert.equal(results.scenario5.violations[0].durationMinutes, 50);
  });

  await t.test("NFR: Streaming sliding window cho kết quả hoàn toàn nhất quán với Batch Evaluation", () => {
    const detectorStreaming = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30 });
    const detectorBatch = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30 });

    const series = buildScenarioReadings(S42_SCENARIOS.scenario3);

    // Xử lý từng số đo đến dần theo luồng
    for (const pt of series) {
      detectorStreaming.processReading(pt);
    }
    const streamingViolations = detectorStreaming.finalize();
    const batchViolations = detectorBatch.evaluateSeries(series);

    assert.equal(streamingViolations.length, batchViolations.length, "Số lượng vi phạm streaming phải khớp batch");
    assert.equal(streamingViolations[0].startTime, batchViolations[0].startTime);
    assert.equal(streamingViolations[0].endTime, batchViolations[0].endTime);
    assert.equal(streamingViolations[0].peakTemperature, batchViolations[0].peakTemperature);
    assert.equal(streamingViolations[0].durationMinutes, batchViolations[0].durationMinutes);
  });

  await t.test("Edge Cases: Xử lý danh sách rỗng, số đo không có thứ tự, và chính xác tại mốc 30 phút", () => {
    const detector = new ColdChainViolationDetector({ threshold: 8.0, minDurationMinutes: 30 });

    // 1. Mảng rỗng
    assert.deepEqual(detector.evaluateSeries([]), []);

    // 2. Đúng chính xác 30 phút (không quá 30 phút -> không vi phạm)
    const baseTime = new Date("2026-10-17T08:00:00.000Z").getTime();
    const exact30Min = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 30 * 60 * 1000).toISOString(), temperature: 9.2 },
      { recordedAt: new Date(baseTime + 31 * 60 * 1000).toISOString(), temperature: 5.0 },
    ];
    // Thời lượng = 30 phút tròn, tiêu chí là "quá 30 phút" (> 30)
    assert.equal(detector.evaluateSeries(exact30Min).length, 0);

    // 3. 30 phút 1 giây (đã quá 30 phút -> 1 vi phạm)
    const over30Min = [
      { recordedAt: new Date(baseTime).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 30 * 60 * 1000 + 1000).toISOString(), temperature: 9.2 },
      { recordedAt: new Date(baseTime + 31 * 60 * 1000).toISOString(), temperature: 5.0 },
    ];
    assert.equal(detector.evaluateSeries(over30Min).length, 1);

    // 4. Số đo truyền vào không theo thứ tự thời gian (Unordered Telemetry)
    const unordered = [
      { recordedAt: new Date(baseTime + 45 * 60 * 1000).toISOString(), temperature: 10.0 },
      { recordedAt: new Date(baseTime).toISOString(), temperature: 9.0 },
      { recordedAt: new Date(baseTime + 20 * 60 * 1000).toISOString(), temperature: 13.5 },
      { recordedAt: new Date(baseTime + 46 * 60 * 1000).toISOString(), temperature: 4.0 },
    ];
    const unorderedResult = detector.evaluateSeries(unordered);
    assert.equal(unorderedResult.length, 1);
    assert.equal(unorderedResult[0].peakTemperature, 13.5);
    assert.equal(unorderedResult[0].durationMinutes, 45);
  });
});
