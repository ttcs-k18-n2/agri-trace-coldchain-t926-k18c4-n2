/**
 * Cold Chain Threshold Monitoring & Violation Detection Service (Story S-43 / Jira N2-111)
 *
 * User Story:
 * "Là cán bộ kiểm tra tôi muốn chỉ những lần vượt ngưỡng kéo dài mới bị tính là vi phạm
 * để hệ thống không báo động liên tục vì mấy phút mở cửa xe"
 *
 * Acceptance Criteria:
 * - AC1: Nhiệt độ vượt ngưỡng liên tục quá 30 phút thì sinh một vi phạm ghi rõ: bắt đầu, kết thúc, đỉnh.
 * - AC2: Vượt ngắn (<= 30 phút) rồi trở lại bình thường thì không tính là vi phạm.
 * - AC3: Hai lần vượt cách nhau dưới 5 phút (< 5 phút) tính là MỘT vi phạm (gộp lại).
 * - AC4: Hai lần vượt cách nhau từ 5 phút trở lên (>= 5 phút) tính là HAI vi phạm riêng biệt.
 * - AC5: Số vi phạm khớp đáp án của cả 5 kịch bản ở S-42.
 * - NFR: Thuật toán cửa sổ trượt (sliding window) chạy được theo luồng số đo đến dần (streaming).
 */

const crypto = require("crypto");

const DEFAULT_THRESHOLD_TEMP = 8.0; // 8°C chuẩn cho chuỗi lạnh rau quả / thực phẩm
const DEFAULT_MIN_DURATION_MINUTES = 30; // Quá 30 phút mới tính là vi phạm
const DEFAULT_MERGE_GAP_MINUTES = 5; // Dưới 5 phút thì gộp

// In-memory fallback stores for test and demo mode
const inMemoryReadings = [];
const inMemoryViolations = [];
const streamingDetectors = new Map(); // key: shipmentId or coldBoxId -> ColdChainViolationDetector

/**
 * Lớp thuật toán cốt lõi xử lý phát hiện vi phạm ngưỡng theo lô hoặc theo luồng (Sliding Window)
 */
class ColdChainViolationDetector {
  constructor(options = {}) {
    this.threshold = Number(options.threshold ?? DEFAULT_THRESHOLD_TEMP);
    this.minDurationMinutes = Number(options.minDurationMinutes ?? DEFAULT_MIN_DURATION_MINUTES);
    this.mergeGapMinutes = Number(options.mergeGapMinutes ?? DEFAULT_MERGE_GAP_MINUTES);

    this.minDurationMs = this.minDurationMinutes * 60 * 1000;
    this.mergeGapMs = this.mergeGapMinutes * 60 * 1000;

    // Trạng thái phục vụ luồng đến dần (Streaming Sliding Window)
    this.windowReadings = [];
    this.activeExcursion = null; // Đợt vượt ngưỡng đang diễn ra
    this.pendingSegments = []; // Các đợt vượt ngưỡng đã kết thúc tạm thời, chờ xem có gộp không
    this.confirmedViolations = []; // Danh sách vi phạm đã xác nhận
    this.latestTimestamp = null;
  }

  /**
   * Đánh giá toàn bộ chuỗi số đo nhiệt độ (Batch Evaluation)
   * @param {Array<{ recordedAt: string|Date, temperature: number }>} readings
   * @returns {Array<object>} Danh sách các vi phạm được phát hiện
   */
  evaluateSeries(readings = []) {
    if (!Array.isArray(readings) || readings.length === 0) {
      return [];
    }

    // 1. Chuẩn hóa và sắp xếp theo thời gian tăng dần
    const sorted = readings
      .map((r) => ({
        recordedAt: new Date(r.recordedAt || r.timestamp || r.time).getTime(),
        temperature: Number(r.temperature ?? r.temp),
        raw: r,
      }))
      .filter((r) => !Number.isNaN(r.recordedAt) && !Number.isNaN(r.temperature))
      .sort((a, b) => a.recordedAt - b.recordedAt);

    if (sorted.length === 0) return [];

    // 2. Tách thành các đoạn vượt ngưỡng liên tục (Continuous Excursion Segments)
    const rawSegments = [];
    let currentSegment = null;

    for (let i = 0; i < sorted.length; i++) {
      const pt = sorted[i];
      const isExcursion = pt.temperature > this.threshold;

      if (isExcursion) {
        if (!currentSegment) {
          currentSegment = {
            startTime: pt.recordedAt,
            endTime: pt.recordedAt,
            peakTemperature: pt.temperature,
            readingsCount: 1,
            readings: [pt],
          };
        } else {
          currentSegment.endTime = pt.recordedAt;
          currentSegment.peakTemperature = Math.max(currentSegment.peakTemperature, pt.temperature);
          currentSegment.readingsCount++;
          currentSegment.readings.push(pt);
        }
      } else if (currentSegment) {
        // Nhiệt độ đã hạ về trong ngưỡng an toàn
        rawSegments.push(currentSegment);
        currentSegment = null;
      }
    }

    if (currentSegment) {
      rawSegments.push(currentSegment);
    }

    if (rawSegments.length === 0) return [];

    // 3. Quy tắc gộp khoảng cách: Hai lần vượt cách nhau dưới 5 phút tính là một vi phạm (AC3 & AC4)
    const mergedSegments = [];
    let activeMerged = {
      startTime: rawSegments[0].startTime,
      endTime: rawSegments[0].endTime,
      peakTemperature: rawSegments[0].peakTemperature,
      readingsCount: rawSegments[0].readingsCount,
      excursionsCount: 1,
      subSegments: [rawSegments[0]],
    };

    for (let i = 1; i < rawSegments.length; i++) {
      const nextSeg = rawSegments[i];
      const gapMs = nextSeg.startTime - activeMerged.endTime;

      // Khoảng cách dưới 5 phút (< 300.000 ms) -> Gộp
      if (gapMs < this.mergeGapMs) {
        activeMerged.endTime = nextSeg.endTime;
        activeMerged.peakTemperature = Math.max(activeMerged.peakTemperature, nextSeg.peakTemperature);
        activeMerged.readingsCount += nextSeg.readingsCount;
        activeMerged.excursionsCount += 1;
        activeMerged.subSegments.push(nextSeg);
      } else {
        // Khoảng cách từ 5 phút trở lên (>= 300.000 ms) -> Không gộp
        mergedSegments.push(activeMerged);
        activeMerged = {
          startTime: nextSeg.startTime,
          endTime: nextSeg.endTime,
          peakTemperature: nextSeg.peakTemperature,
          readingsCount: nextSeg.readingsCount,
          excursionsCount: 1,
          subSegments: [nextSeg],
        };
      }
    }
    mergedSegments.push(activeMerged);

    // 4. Lọc độ trễ 30 phút: Chỉ các đợt vượt ngưỡng liên tục (hoặc đã gộp) quá 30 phút mới tính là vi phạm (AC1 & AC2)
    const violations = [];
    for (const seg of mergedSegments) {
      const durationMs = seg.endTime - seg.startTime;
      const durationMinutes = durationMs / (60 * 1000);

      // Nghiệp vụ quy định: "quá 30 phút" -> durationMs > minDurationMs
      if (durationMs > this.minDurationMs) {
        const violationId = `viol-${crypto.randomBytes(4).toString("hex")}`;
        violations.push({
          id: violationId,
          threshold: this.threshold,
          startTime: new Date(seg.startTime).toISOString(),
          endTime: new Date(seg.endTime).toISOString(),
          peakTemperature: Number(seg.peakTemperature.toFixed(2)),
          durationMinutes: Number(durationMinutes.toFixed(2)),
          durationSeconds: Math.round(durationMs / 1000),
          excursionsCount: seg.excursionsCount,
          readingsCount: seg.readingsCount,
          status: "RESOLVED",
          rule: `Vượt ngưỡng ${this.threshold}°C kéo dài > ${this.minDurationMinutes} phút (${durationMinutes.toFixed(1)} phút)`,
        });
      }
    }

    return violations;
  }

  /**
   * Xử lý một số đo đến dần theo luồng (Streaming Ingestion - NFR)
   * @param {{ recordedAt: string|Date, temperature: number }} reading
   * @returns {{ violationTriggered: boolean, violations: Array<object>, currentStatus: string }}
   */
  processReading(reading) {
    const ts = new Date(reading.recordedAt || reading.timestamp || reading.time).getTime();
    const temp = Number(reading.temperature ?? reading.temp);

    if (Number.isNaN(ts) || Number.isNaN(temp)) {
      throw new Error("Số đo không hợp lệ: thiếu thời gian hoặc nhiệt độ.");
    }

    this.latestTimestamp = ts;
    this.windowReadings.push({ recordedAt: ts, temperature: temp, raw: reading });

    // Kiểm tra hết hạn của các đợt pendingSegments cách đây >= 5 phút
    this._flushExpiredPendingSegments(ts);

    const isExcursion = temp > this.threshold;

    if (isExcursion) {
      // Đang vượt ngưỡng
      if (this.pendingSegments.length > 0) {
        // Kiểm tra xem đợt trước đó có kết thúc cách đây < 5 phút không
        const lastPending = this.pendingSegments[this.pendingSegments.length - 1];
        const gapMs = ts - lastPending.endTime;
        if (gapMs < this.mergeGapMs) {
          // Gộp vào đợt pending trước đó và tiếp tục active!
          this.activeExcursion = this.pendingSegments.pop();
          this.activeExcursion.endTime = ts;
          this.activeExcursion.peakTemperature = Math.max(this.activeExcursion.peakTemperature, temp);
          this.activeExcursion.readingsCount++;
          this.activeExcursion.excursionsCount++;
        } else {
          // Flush tất cả pending vì gap >= 5 phút
          this._finalizePendingSegments();
          this.activeExcursion = {
            startTime: ts,
            endTime: ts,
            peakTemperature: temp,
            readingsCount: 1,
            excursionsCount: 1,
          };
        }
      } else if (!this.activeExcursion) {
        this.activeExcursion = {
          startTime: ts,
          endTime: ts,
          peakTemperature: temp,
          readingsCount: 1,
          excursionsCount: 1,
        };
      } else {
        this.activeExcursion.endTime = ts;
        this.activeExcursion.peakTemperature = Math.max(this.activeExcursion.peakTemperature, temp);
        this.activeExcursion.readingsCount++;
      }
    } else {
      // Nhiệt độ bình thường
      if (this.activeExcursion) {
        // Tạm đóng excursion này và đưa vào pendingSegments để chờ xem có đợt mới trong vòng < 5 phút không
        this.pendingSegments.push(this.activeExcursion);
        this.activeExcursion = null;
      }
    }

    return {
      activeExcursion: this.activeExcursion
        ? {
            startTime: new Date(this.activeExcursion.startTime).toISOString(),
            currentDurationMinutes: Number(
              ((this.activeExcursion.endTime - this.activeExcursion.startTime) / (60 * 1000)).toFixed(2)
            ),
            peakTemperature: this.activeExcursion.peakTemperature,
            isOver30Min: this.activeExcursion.endTime - this.activeExcursion.startTime > this.minDurationMs,
          }
        : null,
      confirmedViolations: this.getViolations(),
    };
  }

  /**
   * Đóng toàn bộ các segment khi kết thúc chuyến hoặc force flush
   */
  finalize() {
    if (this.activeExcursion) {
      this.pendingSegments.push(this.activeExcursion);
      this.activeExcursion = null;
    }
    this._finalizePendingSegments();
    return this.getViolations();
  }

  _flushExpiredPendingSegments(currentTs) {
    const remaining = [];
    for (const seg of this.pendingSegments) {
      if (currentTs - seg.endTime >= this.mergeGapMs) {
        this._checkAndAddViolation(seg);
      } else {
        remaining.push(seg);
      }
    }
    this.pendingSegments = remaining;
  }

  _finalizePendingSegments() {
    for (const seg of this.pendingSegments) {
      this._checkAndAddViolation(seg);
    }
    this.pendingSegments = [];
  }

  _checkAndAddViolation(seg) {
    const durationMs = seg.endTime - seg.startTime;
    if (durationMs > this.minDurationMs) {
      const durationMinutes = durationMs / (60 * 1000);
      this.confirmedViolations.push({
        id: `viol-${crypto.randomBytes(4).toString("hex")}`,
        threshold: this.threshold,
        startTime: new Date(seg.startTime).toISOString(),
        endTime: new Date(seg.endTime).toISOString(),
        peakTemperature: Number(seg.peakTemperature.toFixed(2)),
        durationMinutes: Number(durationMinutes.toFixed(2)),
        durationSeconds: Math.round(durationMs / 1000),
        excursionsCount: seg.excursionsCount,
        readingsCount: seg.readingsCount,
        status: "RESOLVED",
        rule: `Vượt ngưỡng ${this.threshold}°C kéo dài > ${this.minDurationMinutes} phút (${durationMinutes.toFixed(1)} phút)`,
      });
    }
  }

  getViolations() {
    return [...this.confirmedViolations];
  }
}

/**
 * BỘ 5 KỊCH BẢN CHUẨN S-42 ĐÃ ĐỐI CHIẾU ĐÁP ÁN ĐẾM TAY (AC5)
 */
const S42_SCENARIOS = {
  scenario1: {
    id: "S42-SC-01",
    name: "Kịch bản 1: Mở cửa xe ngắn (Bốc xếp nhanh - Không vi phạm)",
    description: "Xe mở cửa bốc xếp trong 12 phút, nhiệt độ vọt lên 10.5°C rồi hạ về 3.8°C. Không quá 30 phút.",
    expectedViolationsCount: 0,
    readings: [
      { minute: 0, temp: 4.0 },
      { minute: 5, temp: 4.2 },
      { minute: 10, temp: 9.2 }, // Bắt đầu vượt 8°C lúc phút 10
      { minute: 15, temp: 10.5 }, // Đỉnh
      { minute: 22, temp: 8.5 },
      { minute: 23, temp: 6.0 }, // Về ngưỡng an toàn lúc phút 23 (kéo dài 12 phút <= 30 phút)
      { minute: 30, temp: 4.0 },
      { minute: 40, temp: 3.8 },
    ],
  },
  scenario2: {
    id: "S42-SC-02",
    name: "Kịch bản 2: Sự cố hỏng máy lạnh liên tục (1 vi phạm đơn lẻ)",
    description: "Hỏng máy lạnh, nhiệt độ vượt 8°C duy trì liên tục suốt 45 phút, đạt đỉnh 14.5°C trước khi hạ nhiệt.",
    expectedViolationsCount: 1,
    expectedPeakTemperature: 14.5,
    expectedDurationMinutes: 45,
    readings: [
      { minute: 0, temp: 4.0 },
      { minute: 5, temp: 4.5 },
      { minute: 10, temp: 9.0 }, // Vượt ngưỡng lúc phút 10
      { minute: 20, temp: 12.0 },
      { minute: 30, temp: 14.5 }, // Đỉnh
      { minute: 40, temp: 13.0 },
      { minute: 50, temp: 10.0 },
      { minute: 55, temp: 8.5 }, // Kết thúc đợt vượt lúc phút 55 (55 - 10 = 45 phút > 30 phút)
      { minute: 56, temp: 6.5 }, // Hạ về an toàn
      { minute: 65, temp: 4.0 },
    ],
  },
  scenario3: {
    id: "S42-SC-03",
    name: "Kịch bản 3: Hai lần vượt cách nhau dưới 5 phút (Gộp thành 1 vi phạm)",
    description:
      "Lần 1 vượt 20 phút (đỉnh 10.2°C). Nghỉ 3 phút (< 5 phút) ở mức 7.5°C. Lần 2 vượt tiếp 22 phút (đỉnh 11.8°C). Gộp lại thành 1 đợt 45 phút > 30 phút.",
    expectedViolationsCount: 1,
    expectedPeakTemperature: 11.8,
    expectedDurationMinutes: 45,
    expectedMergedExcursions: 2,
    readings: [
      { minute: 0, temp: 4.0 },
      // Lần 1: phút 10 -> phút 30 (20 phút, đỉnh 10.2)
      { minute: 10, temp: 9.0 },
      { minute: 20, temp: 10.2 },
      { minute: 30, temp: 8.8 },
      // Khoảng nghỉ: phút 31 -> phút 34 (3 phút < 5 phút)
      { minute: 31, temp: 7.5 },
      { minute: 32, temp: 7.4 },
      // Lần 2: phút 34 -> phút 55 (21-22 phút, đỉnh 11.8)
      { minute: 34, temp: 9.5 },
      { minute: 45, temp: 11.8 },
      { minute: 55, temp: 8.9 },
      // Về ngưỡng an toàn
      { minute: 56, temp: 5.0 },
      { minute: 65, temp: 4.0 },
    ],
  },
  scenario4: {
    id: "S42-SC-04",
    name: "Kịch bản 4: Hai lần vượt cách xa nhau >= 5 phút (Không gộp - 2 vi phạm)",
    description:
      "Lần 1 vượt 40 phút (đỉnh 13.0°C). Nghỉ 25 phút (>= 5 phút) ở mức 4°C. Lần 2 vượt 35 phút (đỉnh 12.2°C). Cả hai đều > 30 phút và không gộp -> 2 vi phạm.",
    expectedViolationsCount: 2,
    expectedPeaks: [13.0, 12.2],
    expectedDurations: [40, 35],
    readings: [
      { minute: 0, temp: 4.0 },
      // Đợt 1: phút 10 -> phút 50 (40 phút > 30)
      { minute: 10, temp: 9.0 },
      { minute: 25, temp: 13.0 }, // Đỉnh đợt 1
      { minute: 50, temp: 8.8 },
      // Khoảng nghỉ an toàn: phút 51 -> phút 74 (24-25 phút >= 5 phút)
      { minute: 51, temp: 4.5 },
      { minute: 60, temp: 4.0 },
      { minute: 74, temp: 4.2 },
      // Đợt 2: phút 75 -> phút 110 (35 phút > 30)
      { minute: 75, temp: 9.5 },
      { minute: 90, temp: 12.2 }, // Đỉnh đợt 2
      { minute: 110, temp: 8.5 },
      // Về an toàn
      { minute: 111, temp: 4.0 },
      { minute: 120, temp: 3.8 },
    ],
  },
  scenario5: {
    id: "S42-SC-05",
    name: "Kịch bản 5: Hai lần cách xa nhau, một lần ngắn <= 30 phút, một lần dài > 30 phút",
    description:
      "Lần 1 ngắn 15 phút (đỉnh 9.5°C). Nghỉ 20 phút (>= 5 phút). Lần 2 dài 50 phút (đỉnh 15.0°C). Không gộp vì cách 20 phút. Lần 1 bỏ qua, chỉ tính lần 2 -> 1 vi phạm.",
    expectedViolationsCount: 1,
    expectedPeakTemperature: 15.0,
    expectedDurationMinutes: 50,
    readings: [
      { minute: 0, temp: 4.0 },
      // Đợt 1 ngắn: phút 10 -> phút 25 (15 phút <= 30 phút)
      { minute: 10, temp: 8.8 },
      { minute: 18, temp: 9.5 },
      { minute: 25, temp: 8.6 },
      // Khoảng nghỉ: phút 26 -> phút 45 (19-20 phút >= 5 phút)
      { minute: 26, temp: 4.0 },
      { minute: 44, temp: 4.2 },
      // Đợt 2 dài: phút 45 -> phút 95 (50 phút > 30 phút)
      { minute: 45, temp: 9.2 },
      { minute: 70, temp: 15.0 }, // Đỉnh đợt 2
      { minute: 95, temp: 8.7 },
      // Về an toàn
      { minute: 96, temp: 4.5 },
      { minute: 105, temp: 4.0 },
    ],
  },
};

/**
 * Biến đổi các điểm thời gian (phút tương đối) trong kịch bản thành chuỗi số đo có ISO timestamp
 */
function buildScenarioReadings(scenario, baseIsoTime = "2026-10-17T08:00:00.000Z") {
  const baseMs = new Date(baseIsoTime).getTime();
  return scenario.readings.map((pt) => ({
    recordedAt: new Date(baseMs + pt.minute * 60 * 1000).toISOString(),
    temperature: pt.temp,
    minute: pt.minute,
  }));
}

/**
 * Chạy kiểm tra tự động toàn bộ 5 kịch bản của S-42
 */
function verifyS42Scenarios(options = {}) {
  const detector = new ColdChainViolationDetector(options);
  const results = {};

  for (const [key, sc] of Object.entries(S42_SCENARIOS)) {
    const series = buildScenarioReadings(sc);
    const violations = detector.evaluateSeries(series);

    const passCount = violations.length === sc.expectedViolationsCount;
    let passPeak = true;
    let passDuration = true;

    if (sc.expectedPeakTemperature !== undefined && violations.length > 0) {
      passPeak = Math.abs(violations[0].peakTemperature - sc.expectedPeakTemperature) < 0.1;
    }
    if (sc.expectedDurationMinutes !== undefined && violations.length > 0) {
      passDuration = Math.abs(violations[0].durationMinutes - sc.expectedDurationMinutes) <= 1.0;
    }

    const passed = passCount && passPeak && passDuration;
    results[key] = {
      scenarioId: sc.id,
      name: sc.name,
      passed,
      expectedViolationsCount: sc.expectedViolationsCount,
      actualViolationsCount: violations.length,
      violations,
    };
  }

  const allPassed = Object.values(results).every((r) => r.passed);
  return { allPassed, results };
}

/**
 * Ghi nhận một số đo nhiệt độ mới (API Service Layer)
 */
async function recordReading({ pool, authContext, data }) {
  const { shipmentId, coldBoxId, temperature, humidity, recordedAt } = data;

  if (!coldBoxId || String(coldBoxId).trim() === "") {
    return { status: 400, success: false, error: "MISSING_COLD_BOX_ID", message: "Thiếu mã thùng lạnh coldBoxId." };
  }
  if (temperature === undefined || temperature === null || Number.isNaN(Number(temperature))) {
    return { status: 400, success: false, error: "INVALID_TEMPERATURE", message: "Giá trị nhiệt độ không hợp lệ." };
  }

  const tempVal = Number(Number(temperature).toFixed(2));
  const humVal = humidity !== undefined && humidity !== null ? Number(Number(humidity).toFixed(2)) : null;
  const timeVal = recordedAt ? new Date(recordedAt) : new Date();

  if (Number.isNaN(timeVal.getTime())) {
    return { status: 400, success: false, error: "INVALID_TIMESTAMP", message: "Thời gian recordedAt không hợp lệ." };
  }

  const readingId = `temp-${crypto.randomBytes(4).toString("hex")}`;
  const orgId = authContext ? authContext.organizationId : "org-trans";

  let savedReading = null;

  if (pool) {
    try {
      const res = await pool.query(
        `INSERT INTO temperature_readings (id, shipment_id, cold_box_id, temperature, humidity, recorded_at, organization_id, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, shipment_id, cold_box_id, temperature, humidity, recorded_at, created_at`,
        [readingId, shipmentId || null, coldBoxId, tempVal, humVal, timeVal.toISOString(), orgId, JSON.stringify(data)]
      );
      savedReading = res.rows[0];
    } catch (err) {
      return { status: 500, success: false, error: "DB_ERROR", message: err.message };
    }
  } else {
    savedReading = {
      id: readingId,
      shipment_id: shipmentId || null,
      cold_box_id: coldBoxId,
      temperature: tempVal,
      humidity: humVal,
      recorded_at: timeVal.toISOString(),
      organization_id: orgId,
      created_at: new Date().toISOString(),
    };
    inMemoryReadings.push(savedReading);
  }

  // Chạy streaming detector cho chuyến / thùng lạnh này
  const streamKey = shipmentId || coldBoxId;
  if (!streamingDetectors.has(streamKey)) {
    streamingDetectors.set(streamKey, new ColdChainViolationDetector());
  }
  const detector = streamingDetectors.get(streamKey);
  const streamResult = detector.processReading({
    recordedAt: timeVal,
    temperature: tempVal,
  });

  // Nếu có vi phạm mới được xác nhận qua streaming, lưu vào DB / memory
  for (const v of streamResult.confirmedViolations) {
    await _persistViolation({ pool, authContext, shipmentId, coldBoxId, violation: v });
  }

  return {
    status: 201,
    success: true,
    message: "Ghi nhận số đo nhiệt độ thành công.",
    reading: savedReading,
    streamingAnalysis: {
      activeExcursion: streamResult.activeExcursion,
      confirmedViolationsCount: streamResult.confirmedViolations.length,
    },
  };
}

/**
 * Lưu trữ bản ghi vi phạm vào DB hoặc Memory
 */
async function _persistViolation({ pool, authContext, shipmentId, coldBoxId, violation }) {
  const orgId = authContext ? authContext.organizationId : "org-trans";
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO temperature_violations 
         (id, shipment_id, cold_box_id, organization_id, threshold_value, start_time, end_time, peak_temperature, duration_minutes, status, excursions_count, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          violation.id,
          shipmentId || null,
          coldBoxId,
          orgId,
          violation.threshold,
          violation.startTime,
          violation.endTime,
          violation.peakTemperature,
          violation.durationMinutes,
          violation.status || "RESOLVED",
          violation.excursionsCount || 1,
          JSON.stringify(violation),
        ]
      );
    } catch {
      // Bỏ qua nếu lỗi DB
    }
  } else {
    const exists = inMemoryViolations.some((v) => v.id === violation.id);
    if (!exists) {
      inMemoryViolations.push({
        ...violation,
        shipment_id: shipmentId || null,
        cold_box_id: coldBoxId,
        organization_id: orgId,
      });
    }
  }
}

/**
 * Lấy danh sách vi phạm (có phân quyền Cán bộ kiểm tra và đa tổ chức)
 */
async function getViolations({ pool, authContext, shipmentId, coldBoxId, limit = 50, offset = 0 }) {
  const isInspector = authContext?.isInspector || authContext?.roleId === "admin";
  const userOrgId = authContext?.organizationId;

  if (pool) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (!isInspector && userOrgId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(userOrgId);
    }

    if (shipmentId) {
      conditions.push(`shipment_id = $${idx++}`);
      params.push(shipmentId);
    }
    if (coldBoxId) {
      conditions.push(`cold_box_id = $${idx++}`);
      params.push(coldBoxId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM temperature_violations ${whereClause} ORDER BY start_time DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const res = await pool.query(sql, params);
    return {
      success: true,
      violations: res.rows.map((row) => ({
        id: row.id,
        shipmentId: row.shipment_id,
        coldBoxId: row.cold_box_id,
        threshold: Number(row.threshold_value),
        startTime: row.start_time,
        endTime: row.end_time,
        peakTemperature: Number(row.peak_temperature),
        durationMinutes: Number(row.duration_minutes),
        status: row.status,
        excursionsCount: row.excursions_count,
        details: row.details,
        createdAt: row.created_at,
      })),
    };
  }

  // In-memory fallback
  let list = inMemoryViolations;
  if (!isInspector && userOrgId) {
    list = list.filter((v) => v.organization_id === userOrgId);
  }
  if (shipmentId) {
    list = list.filter((v) => v.shipment_id === shipmentId || v.shipmentId === shipmentId);
  }
  if (coldBoxId) {
    list = list.filter((v) => v.cold_box_id === coldBoxId || v.coldBoxId === coldBoxId);
  }

  return {
    success: true,
    violations: list.slice(offset, offset + limit),
  };
}

/**
 * Lấy lịch sử số đo nhiệt độ
 */
async function getReadings({ pool, authContext, shipmentId, coldBoxId, limit = 100 }) {
  const isInspector = authContext?.isInspector || authContext?.roleId === "admin";
  const userOrgId = authContext?.organizationId;

  if (pool) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (!isInspector && userOrgId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(userOrgId);
    }
    if (shipmentId) {
      conditions.push(`shipment_id = $${idx++}`);
      params.push(shipmentId);
    }
    if (coldBoxId) {
      conditions.push(`cold_box_id = $${idx++}`);
      params.push(coldBoxId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM temperature_readings ${whereClause} ORDER BY recorded_at ASC LIMIT $${idx++}`;
    params.push(Number(limit));

    const res = await pool.query(sql, params);
    return { success: true, readings: res.rows };
  }

  let list = inMemoryReadings;
  if (!isInspector && userOrgId) {
    list = list.filter((r) => r.organization_id === userOrgId);
  }
  if (shipmentId) {
    list = list.filter((r) => r.shipment_id === shipmentId);
  }
  if (coldBoxId) {
    list = list.filter((r) => r.cold_box_id === coldBoxId);
  }

  return { success: true, readings: list.slice(0, limit) };
}

/**
 * Đánh giá một chuỗi số đo theo yêu cầu (API on-demand evaluation)
 */
function evaluateSeriesDirect(readings, options = {}) {
  const detector = new ColdChainViolationDetector(options);
  const violations = detector.evaluateSeries(readings);
  return {
    success: true,
    threshold: detector.threshold,
    minDurationMinutes: detector.minDurationMinutes,
    mergeGapMinutes: detector.mergeGapMinutes,
    violationsCount: violations.length,
    violations,
  };
}

module.exports = {
  DEFAULT_THRESHOLD_TEMP,
  DEFAULT_MIN_DURATION_MINUTES,
  DEFAULT_MERGE_GAP_MINUTES,
  ColdChainViolationDetector,
  S42_SCENARIOS,
  buildScenarioReadings,
  verifyS42Scenarios,
  recordReading,
  getViolations,
  getReadings,
  evaluateSeriesDirect,
  inMemoryReadings,
  inMemoryViolations,
  streamingDetectors,
};
