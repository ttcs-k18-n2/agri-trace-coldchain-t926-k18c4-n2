const crypto = require("node:crypto");
const { appendBatchEvent, inMemoryBatchEvents } = require("./event_repository");
const { inMemoryShipments, inMemoryShipmentLots } = require("./shipment_service");

const DEFAULT_THRESHOLD_TEMP = Number(process.env.COLD_CHAIN_THRESHOLD || 8.0);
const DEFAULT_MIN_DURATION_MINUTES = 30; // AC1 & AC2: Phải quá 30 phút mới tính là vi phạm
const DEFAULT_MERGE_GAP_MINUTES = 5; // AC3 & AC4: Hai lần vượt cách nhau dưới 5 phút tính là 1 vi phạm

// Bộ nhớ in-memory phục vụ môi trường test không có PostgreSQL
const inMemoryViolations = [];
const inMemoryReadings = [];
const streamingDetectors = new Map();

/**
 * Thuật toán phát hiện vi phạm nhiệt độ chuỗi cung ứng lạnh (Story S-43)
 * Hỗ trợ cả hai chế độ:
 * 1. Đánh giá toàn bộ chuỗi số đo (Batch Evaluation)
 * 2. Đánh giá dần theo luồng (Streaming Sliding Window Ingestion)
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
   * @returns {{ ignored: boolean, activeExcursion: object|null, confirmedViolations: Array<object> }}
   */
  processReading(reading) {
    const rawTime = reading.recordedAt ?? reading.timestamp ?? reading.time;
    const rawTemperature = reading.temperature ?? reading.temp;
    const ts = new Date(rawTime).getTime();
    const temp = Number(rawTemperature);

    if (rawTime == null || typeof rawTime === "boolean" ||
        rawTemperature == null || typeof rawTemperature === "boolean" ||
        (typeof rawTemperature === "string" && !rawTemperature.trim()) ||
        !Number.isFinite(ts) || !Number.isFinite(temp)) {
      throw new Error("Số đo không hợp lệ: thiếu thời gian hoặc nhiệt độ.");
    }

    if (this.latestTimestamp !== null && ts <= this.latestTimestamp) {
      return this._snapshot(true);
    }
    this.latestTimestamp = ts;
    // Bounded window reading storage
    this.windowReadings = [{ recordedAt: ts, temperature: temp }];

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

    if (this.activeExcursion) {
      this._checkAndAddViolation(this.activeExcursion, "ONGOING");
    }
    return this._snapshot(false);
  }

  _snapshot(ignored) {
    return {
      ignored,
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
        this._checkAndAddViolation(seg, "RESOLVED");
      } else {
        remaining.push(seg);
      }
    }
    this.pendingSegments = remaining;
  }

  _finalizePendingSegments() {
    for (const seg of this.pendingSegments) {
      this._checkAndAddViolation(seg, "RESOLVED");
    }
    this.pendingSegments = [];
  }

  _checkAndAddViolation(seg, status = "RESOLVED") {
    const durationMs = seg.endTime - seg.startTime;
    if (durationMs > this.minDurationMs) {
      const durationMinutes = durationMs / (60 * 1000);
      if (!seg.violationId) {
        seg.violationId = `viol-${crypto.randomBytes(4).toString("hex")}`;
      }
      const violation = {
        id: seg.violationId,
        threshold: this.threshold,
        startTime: new Date(seg.startTime).toISOString(),
        endTime: new Date(seg.endTime).toISOString(),
        peakTemperature: Number(seg.peakTemperature.toFixed(2)),
        durationMinutes: Number(durationMinutes.toFixed(2)),
        durationSeconds: Math.round(durationMs / 1000),
        excursionsCount: seg.excursionsCount,
        readingsCount: seg.readingsCount,
        status,
        rule: `Vượt ngưỡng ${this.threshold}°C kéo dài > ${this.minDurationMinutes} phút (${durationMinutes.toFixed(1)} phút)`,
      };
      const existingIndex = this.confirmedViolations.findIndex((item) => item.id === violation.id);
      if (existingIndex === -1) {
        this.confirmedViolations.push(violation);
      } else {
        this.confirmedViolations[existingIndex] = violation;
      }
    }
  }

  getViolations() {
    return this.confirmedViolations.map((item) => ({ ...item }));
  }

  toBoundedJSON() {
    return {
      threshold: this.threshold,
      minDurationMinutes: this.minDurationMinutes,
      mergeGapMinutes: this.mergeGapMinutes,
      latestTimestamp: this.latestTimestamp,
      activeExcursion: this.activeExcursion ? { ...this.activeExcursion } : null,
      pendingSegments: this.pendingSegments.map((s) => ({ ...s })),
      confirmedViolations: this.confirmedViolations
        .filter((v) => v.status === "ONGOING" || (this.activeExcursion && this.activeExcursion.violationId === v.id))
        .map((v) => ({ ...v })),
      windowReadings: this.windowReadings.slice(0, 1),
    };
  }

  static fromJSON(state, options = {}) {
    const detector = new ColdChainViolationDetector({
      threshold: state?.threshold ?? options.threshold,
      minDurationMinutes: state?.minDurationMinutes ?? options.minDurationMinutes,
      mergeGapMinutes: state?.mergeGapMinutes ?? options.mergeGapMinutes,
    });
    if (state) {
      detector.activeExcursion = state.activeExcursion ? { ...state.activeExcursion } : null;
      detector.pendingSegments = Array.isArray(state.pendingSegments)
        ? state.pendingSegments.map((s) => ({ ...s }))
        : [];
      detector.latestTimestamp = state.latestTimestamp ?? null;
      detector.confirmedViolations = Array.isArray(state.confirmedViolations)
        ? state.confirmedViolations.map((v) => ({ ...v }))
        : [];
      if (Array.isArray(state.windowReadings)) {
        detector.windowReadings = state.windowReadings.slice(0, 1);
      }
    }
    return detector;
  }
}

/**
 * Hook xử lý số đo nhiệt độ đã được S-41 chấp nhận (Accepted Reading Hook)
 * Được gọi trực tiếp từ transaction của recordShipmentTemperature trước khi COMMIT.
 * Không bị ô nhiễm bởi tham số tổ chức hay ngưỡng do client tự ý gửi lên.
 */
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
 * Ghi nhận sự kiện TEMPERATURE_VIOLATION vào chuỗi hash-chain của từng lô hàng thuộc chuyến (Story S-45 / N2-113 / N2-221)
 * - Khi vi phạm kết thúc (status = RESOLVED), mọi lô liên quan phải có sự kiện tương ứng.
 * - Lưu thông tin thời điểm, thời lượng, nhiệt độ đỉnh, mã vi phạm và mã chuyến.
 * - Idempotency: Không ghi trùng khi nhận lại cùng một sự kiện vi phạm cho cùng một lô.
 * - Bảo toàn hash-chain và tính nguyên tử giao dịch.
 */
async function recordViolationEventsForShipmentLots({
  dbClient = null,
  shipment,
  violation,
  coldBoxId = null,
  organizationId = null,
}) {
  if (!shipment || !violation || !violation.id) {
    return [];
  }

  const shipmentId = shipment.id || shipment.shipmentId;
  const shipmentCode = shipment.code || shipmentId;
  const cBoxId = coldBoxId || shipment.cold_box_id || shipment.coldBoxId || null;
  const shipOrgId = organizationId || shipment.organization_id || shipment.organizationId;

  const payload = {
    violationId: violation.id,
    shipmentId,
    shipmentCode,
    coldBoxId: cBoxId,
    threshold: violation.threshold,
    startTime: violation.startTime,
    endTime: violation.endTime,
    durationMinutes: violation.durationMinutes,
    durationSeconds: violation.durationSeconds,
    peakTemperature: violation.peakTemperature,
    rule: violation.rule,
    status: violation.status || "RESOLVED",
  };

  const createdEvents = [];

  if (dbClient && typeof dbClient.query === "function") {
    // 1. Lấy danh sách tất cả các lô thuộc chuyến vận chuyển (sắp xếp tăng dần theo lot_id để tránh deadlock)
    const lotsRes = await dbClient.query(
      `SELECT sl.lot_id, l.organization_id
       FROM shipment_lots sl
       JOIN lots l ON sl.lot_id = l.id
       WHERE sl.shipment_id = $1
       ORDER BY sl.lot_id ASC`,
      [shipmentId]
    );

    for (const row of lotsRes.rows) {
      const lotId = row.lot_id;
      const lotOrgId = row.organization_id || shipOrgId;

      // 2. Kiểm tra tính lũy kế (idempotency): Không ghi trùng nếu vi phạm này đã được ghi vào chuỗi của lô
      const existingCheck = await dbClient.query(
        `SELECT 1 FROM batch_events
         WHERE batch_id = $1
           AND event_type = 'TEMPERATURE_VIOLATION'
           AND (payload->>'violationId' = $2 OR payload->>'violation_id' = $2)
         LIMIT 1`,
        [lotId, violation.id]
      );

      if (existingCheck.rows.length === 0) {
        const ev = await appendBatchEvent(dbClient, {
          batchId: lotId,
          eventType: "TEMPERATURE_VIOLATION",
          payload,
          organizationId: lotOrgId,
          actorUserId: shipment.created_by_user_id || shipment.createdByUserId || null,
          occurredAt: violation.endTime || new Date(),
        });
        createdEvents.push(ev);
      }
    }
  } else {
    // In-memory fallback
    const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === shipmentId);
    for (const sl of attached) {
      const lotId = sl.lotId;
      const lotOrgId = sl.lotOrgId || shipOrgId;

      const alreadyRecorded = inMemoryBatchEvents.some(
        (e) =>
          e.batchId === lotId &&
          e.eventType === "TEMPERATURE_VIOLATION" &&
          (e.payload?.violationId === violation.id || e.payload?.violation_id === violation.id)
      );

      if (!alreadyRecorded) {
        const ev = await appendBatchEvent(null, {
          batchId: lotId,
          eventType: "TEMPERATURE_VIOLATION",
          payload,
          organizationId: lotOrgId,
          actorUserId: shipment.createdByUserId || null,
          occurredAt: violation.endTime || new Date(),
        });
        createdEvents.push(ev);
      }
    }
  }

  return createdEvents;
}

/**
 * Hoàn tất và chốt các vi phạm nhiệt độ còn dang dở khi kết thúc chuyến vận chuyển (S-45 / S-43)
 */
async function finalizeShipmentViolations({
  client = null,
  pool = null,
  shipment,
  coldBoxId = null,
  organizationId = null,
}) {
  const dbClient = client || pool;
  if (!shipment) return [];

  let rawState = shipment.detector_state || shipment.detectorState;
  if (typeof rawState === "string") {
    try {
      rawState = JSON.parse(rawState);
    } catch {
      rawState = null;
    }
  }
  if (!rawState) return [];

  const configuredThreshold = Number(process.env.COLD_CHAIN_THRESHOLD || rawState.threshold || DEFAULT_THRESHOLD_TEMP);
  const detector = ColdChainViolationDetector.fromJSON(rawState, { threshold: configuredThreshold });
  const finalViolations = detector.finalize();

  const cBoxId = coldBoxId || shipment.cold_box_id || shipment.coldBoxId;
  const orgId = organizationId || shipment.organization_id || shipment.organizationId;
  const shipmentId = shipment.id || shipment.shipmentId;

  if (dbClient && typeof dbClient.query === "function") {
    for (const v of finalViolations) {
      if (v.status === "RESOLVED") {
        await dbClient.query(
          `INSERT INTO temperature_violations (
            id, shipment_id, cold_box_id, organization_id, threshold_value,
            start_time, end_time, peak_temperature, duration_minutes, status,
            excursions_count, details, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            end_time = EXCLUDED.end_time,
            peak_temperature = EXCLUDED.peak_temperature,
            duration_minutes = EXCLUDED.duration_minutes,
            status = EXCLUDED.status,
            excursions_count = EXCLUDED.excursions_count,
            details = EXCLUDED.details,
            updated_at = NOW()`,
          [
            v.id,
            shipmentId,
            cBoxId,
            orgId,
            v.threshold,
            v.startTime,
            v.endTime,
            v.peakTemperature,
            v.durationMinutes,
            v.status || "RESOLVED",
            v.excursionsCount || 1,
            JSON.stringify(v),
          ]
        );

        await recordViolationEventsForShipmentLots({
          dbClient,
          shipment,
          violation: v,
          coldBoxId: cBoxId,
          organizationId: orgId,
        });
      }
    }

    const boundedState = detector.toBoundedJSON();
    await dbClient.query(
      `UPDATE shipments
       SET detector_state = $2
       WHERE id = $1`,
      [shipmentId, JSON.stringify(boundedState)]
    );
    shipment.detector_state = boundedState;
  } else {
    for (const v of finalViolations) {
      if (v.status === "RESOLVED") {
        const existingIdx = inMemoryViolations.findIndex((iv) => iv.id === v.id);
        const record = {
          ...v,
          shipment_id: shipmentId,
          shipmentId,
          cold_box_id: cBoxId,
          coldBoxId: cBoxId,
          organization_id: orgId,
          organizationId: orgId,
          updated_at: new Date().toISOString(),
        };
        if (existingIdx !== -1) {
          inMemoryViolations[existingIdx] = record;
        } else {
          inMemoryViolations.push(record);
        }

        await recordViolationEventsForShipmentLots({
          dbClient: null,
          shipment,
          violation: v,
          coldBoxId: cBoxId,
          organizationId: orgId,
        });
      }
    }

    const boundedState = detector.toBoundedJSON();
    shipment.detector_state = boundedState;
    shipment.detectorState = boundedState;
  }

  return finalViolations;
}

/**
 * Ghi nhận một số đo nhiệt độ mới (API Service Layer)
 */

async function handleAcceptedTemperatureReading({
  client = null,
  pool = null,
  shipment,
  coldBoxId,
  temperature,
  recordedAt,
  _authContext = null,
  threshold = DEFAULT_THRESHOLD_TEMP,
}) {
  const dbClient = client || pool;
  const shipmentId = shipment.id;
  const cBoxId = coldBoxId || shipment.cold_box_id || shipment.coldBoxId;
  const orgId = shipment.organization_id || shipment.organizationId;
  const configuredThreshold = Number(process.env.COLD_CHAIN_THRESHOLD || threshold || DEFAULT_THRESHOLD_TEMP);

  // 1. Tải trạng thái detector bền vững đã lưu trên chuyến
  let rawState = shipment.detector_state || shipment.detectorState;
  if (typeof rawState === "string") {
    try {
      rawState = JSON.parse(rawState);
    } catch {
      rawState = null;
    }
  }

  // 2. Khởi tạo detector từ trạng thái hiện có
  const detector = ColdChainViolationDetector.fromJSON(rawState, { threshold: configuredThreshold });

  // 3. Xử lý một số đo vừa được chấp nhận
  const streamResult = detector.processReading({
    recordedAt,
    temperature,
  });

  // 4. Lưu / Cập nhật các bản ghi vi phạm (Upsert giữ nguyên ID ổn định)
  const violationsToPersist = detector.getViolations();

  if (dbClient) {
    for (const v of violationsToPersist) {
      await dbClient.query(
        `INSERT INTO temperature_violations (
          id, shipment_id, cold_box_id, organization_id, threshold_value,
          start_time, end_time, peak_temperature, duration_minutes, status,
          excursions_count, details, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          end_time = EXCLUDED.end_time,
          peak_temperature = EXCLUDED.peak_temperature,
          duration_minutes = EXCLUDED.duration_minutes,
          status = EXCLUDED.status,
          excursions_count = EXCLUDED.excursions_count,
          details = EXCLUDED.details,
          updated_at = NOW()`,
        [
          v.id,
          shipmentId,
          cBoxId,
          orgId,
          v.threshold,
          v.startTime,
          v.endTime,
          v.peakTemperature,
          v.durationMinutes,
          v.status || "RESOLVED",
          v.excursionsCount || 1,
          JSON.stringify(v),
        ]
      );
    }

    for (const v of violationsToPersist) {
      if (v.status === "RESOLVED") {
        await recordViolationEventsForShipmentLots({
          dbClient,
          shipment,
          violation: v,
          coldBoxId: cBoxId,
          organizationId: orgId,
        });
      }
    }

    // 5. Cập nhật trạng thái detector bền vững giới hạn kích thước trên bảng shipments
    const boundedState = detector.toBoundedJSON();
    await dbClient.query(
      `UPDATE shipments
       SET detector_state = $2
       WHERE id = $1`,
      [shipmentId, JSON.stringify(boundedState)]
    );
    shipment.detector_state = boundedState;
  } else {
    // Lưu vào In-Memory
    for (const v of violationsToPersist) {
      const existingIdx = inMemoryViolations.findIndex((iv) => iv.id === v.id);
      const record = {
        ...v,
        shipment_id: shipmentId,
        shipmentId,
        cold_box_id: cBoxId,
        coldBoxId: cBoxId,
        organization_id: orgId,
        organizationId: orgId,
        updated_at: new Date().toISOString(),
      };
      if (existingIdx !== -1) {
        inMemoryViolations[existingIdx] = record;
      } else {
        inMemoryViolations.push(record);
      }

      if (v.status === "RESOLVED") {
        await recordViolationEventsForShipmentLots({
          dbClient: null,
          shipment,
          violation: v,
          coldBoxId: cBoxId,
          organizationId: orgId,
        });
      }
    }

    const boundedState = detector.toBoundedJSON();
    shipment.detector_state = boundedState;
    shipment.detectorState = boundedState;
    const targetInMem = inMemoryShipments.find((s) => s.id === shipmentId);
    if (targetInMem) {
      targetInMem.detector_state = boundedState;
      targetInMem.detectorState = boundedState;
    }
  }

  return {
    streamResult,
    detectorState: detector.toBoundedJSON(),
    violations: violationsToPersist,
  };
}

/**
 * Định dạng phản hồi danh sách vi phạm theo chuẩn Response Contract của S-43 Phase 2:
 * { shipmentId, coldBoxId, organizationId, violations, count, summary }
 */
function formatViolationsResponse({ shipmentId, coldBoxId, organizationId, rawViolations = [] }) {
  const violations = rawViolations.map((row) => {
    const status = row.status || "RESOLVED";
    const rawDetails = typeof row.details === "string" ? JSON.parse(row.details) : row.details;

    let endTime = null;
    if (status === "RESOLVED") {
      const rawEndTime = row.end_time || row.endTime;
      endTime = rawEndTime ? new Date(rawEndTime).toISOString() : null;
    }

    const rawStartTime = row.start_time || row.startTime;
    const startTime = rawStartTime ? new Date(rawStartTime).toISOString() : null;

    const peakTemperature = Number(Number(row.peak_temperature ?? row.peakTemperature ?? 0).toFixed(2));
    const durationMinutes = Number(Number(row.duration_minutes ?? row.durationMinutes ?? 0).toFixed(2));
    const sampleCount = Number(
      row.sample_count ??
        row.sampleCount ??
        row.readings_count ??
        row.readingsCount ??
        rawDetails?.readingsCount ??
        rawDetails?.sampleCount ??
        row.excursions_count ??
        1
    );

    return {
      id: row.id,
      startTime,
      endTime,
      peakTemperature,
      durationMinutes,
      status,
      sampleCount,
    };
  });

  const count = violations.length;
  const ongoingExcursions = violations.filter((v) => v.status === "ONGOING").length;
  const resolvedExcursions = violations.filter((v) => v.status === "RESOLVED").length;
  const maxPeakTemperature =
    violations.length > 0
      ? Math.max(...violations.map((v) => v.peakTemperature))
      : null;

  return {
    status: 200,
    success: true,
    shipmentId,
    coldBoxId,
    organizationId,
    violations,
    count,
    summary: {
      totalExcursions: count,
      ongoingExcursions,
      resolvedExcursions,
      maxPeakTemperature,
    },
  };
}

/**
 * Lấy danh sách vi phạm theo chuyến vận chuyển: GET /api/shipments/:id/violations
 */
async function getShipmentViolations({
  pool = null,
  authContext = null,
  shipmentId,
  inMemoryShipmentsList = null,
}) {
  if (!shipmentId) {
    return {
      status: 400,
      error: "MISSING_SHIPMENT_ID",
      message: "Mã chuyến vận chuyển là bắt buộc.",
    };
  }

  const userId = authContext ? (authContext.userId || authContext.id) : null;
  if (!userId) {
    return {
      status: 401,
      error: "UNAUTHORIZED",
      message: "Chưa đăng nhập.",
    };
  }

  const isInspector = Boolean(
    authContext && (authContext.roleId === "inspector" || authContext.isInspector)
  );
  const isAdmin = Boolean(
    authContext && (authContext.roleId === "admin" || authContext.isAdmin)
  );
  const isAuthorizedGlobal = isInspector || isAdmin;
  const userOrgId = authContext
    ? (authContext.organizationId || authContext.organization_id)
    : null;

  if (pool) {
    const shipRes = await pool.query(
      "SELECT id, cold_box_id, organization_id, status FROM shipments WHERE id = $1",
      [shipmentId]
    );

    if (shipRes.rows.length === 0) {
      return {
        status: 404,
        error: "SHIPMENT_NOT_FOUND",
        message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
      };
    }

    const shipment = shipRes.rows[0];
    if (!isAuthorizedGlobal && shipment.organization_id !== userOrgId) {
      return {
        status: 403,
        error: "FORBIDDEN",
        message: "Bạn không có quyền truy cập dữ liệu vi phạm nhiệt độ của tổ chức khác.",
      };
    }

    const violRes = await pool.query(
      `SELECT id, shipment_id, cold_box_id, organization_id, threshold_value,
              start_time, end_time, peak_temperature, duration_minutes, status,
              excursions_count, details, created_at, updated_at
       FROM temperature_violations
       WHERE shipment_id = $1
       ORDER BY start_time ASC`,
      [shipmentId]
    );

    return formatViolationsResponse({
      shipmentId: shipment.id,
      coldBoxId: shipment.cold_box_id,
      organizationId: shipment.organization_id,
      rawViolations: violRes.rows,
    });
  }

  // In-Memory
  const shipmentsList = inMemoryShipmentsList || inMemoryShipments;
  const shipment = shipmentsList.find((s) => s.id === shipmentId);
  if (!shipment) {
    return {
      status: 404,
      error: "SHIPMENT_NOT_FOUND",
      message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
    };
  }

  const shipOrgId = shipment.organizationId || shipment.organization_id;
  if (!isAuthorizedGlobal && shipOrgId !== userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN",
      message: "Bạn không có quyền truy cập dữ liệu vi phạm nhiệt độ của tổ chức khác.",
    };
  }

  const list = inMemoryViolations
    .filter((v) => (v.shipmentId || v.shipment_id) === shipmentId)
    .sort((a, b) => {
      const tA = new Date(a.startTime || a.start_time).getTime();
      const tB = new Date(b.startTime || b.start_time).getTime();
      return tA - tB;
    });

  return formatViolationsResponse({
    shipmentId: shipment.id,
    coldBoxId: shipment.coldBoxId || shipment.cold_box_id,
    organizationId: shipOrgId,
    rawViolations: list,
  });
}

/**
 * Lấy danh sách vi phạm theo thùng lạnh: GET /api/cold-boxes/:code/violations
 */
async function getColdBoxViolations({
  pool = null,
  authContext = null,
  coldBoxCode = null,
  shipmentId = null,
  inMemoryShipmentsList = null,
}) {
  const cleanCode = typeof coldBoxCode === "string" ? coldBoxCode.trim() : null;
  if (!cleanCode) {
    return {
      status: 400,
      error: "MISSING_COLD_BOX_CODE",
      message: "Mã thùng lạnh là bắt buộc.",
    };
  }

  const userId = authContext ? (authContext.userId || authContext.id) : null;
  if (!userId) {
    return {
      status: 401,
      error: "UNAUTHORIZED",
      message: "Chưa đăng nhập.",
    };
  }

  const isInspector = Boolean(
    authContext && (authContext.roleId === "inspector" || authContext.isInspector)
  );
  const isAdmin = Boolean(
    authContext && (authContext.roleId === "admin" || authContext.isAdmin)
  );
  const isAuthorizedGlobal = isInspector || isAdmin;
  const userOrgId = authContext
    ? (authContext.organizationId || authContext.organization_id)
    : null;

  if (pool) {
    let shipRes;
    if (shipmentId) {
      shipRes = await pool.query(
        "SELECT id, cold_box_id, organization_id, status FROM shipments WHERE id = $1 AND cold_box_id = $2",
        [shipmentId, cleanCode]
      );
    } else {
      // Ưu tiên chuyến đang hoạt động (IN_TRANSIT), nếu không có lấy chuyến mới nhất
      shipRes = await pool.query(
        `SELECT id, cold_box_id, organization_id, status
         FROM shipments
         WHERE cold_box_id = $1
         ORDER BY (status = 'IN_TRANSIT') DESC, created_at DESC
         LIMIT 1`,
        [cleanCode]
      );
    }

    if (shipRes.rows.length === 0) {
      return {
        status: 404,
        error: "SHIPMENT_NOT_FOUND",
        message: `Không tìm thấy chuyến vận chuyển nào liên kết với thùng lạnh '${cleanCode}'.`,
      };
    }

    const shipment = shipRes.rows[0];
    if (!isAuthorizedGlobal && shipment.organization_id !== userOrgId) {
      return {
        status: 403,
        error: "FORBIDDEN",
        message: "Bạn không có quyền truy cập dữ liệu vi phạm nhiệt độ của tổ chức khác.",
      };
    }

    const violRes = await pool.query(
      `SELECT id, shipment_id, cold_box_id, organization_id, threshold_value,
              start_time, end_time, peak_temperature, duration_minutes, status,
              excursions_count, details, created_at, updated_at
       FROM temperature_violations
       WHERE shipment_id = $1 AND cold_box_id = $2
       ORDER BY start_time ASC`,
      [shipment.id, cleanCode]
    );

    return formatViolationsResponse({
      shipmentId: shipment.id,
      coldBoxId: cleanCode,
      organizationId: shipment.organization_id,
      rawViolations: violRes.rows,
    });
  }

  // In-Memory
  const shipmentsList = inMemoryShipmentsList || inMemoryShipments;
  const matching = shipmentsList.filter(
    (s) => (s.coldBoxId === cleanCode || s.containerId === cleanCode)
  );

  let shipment = null;
  if (shipmentId) {
    shipment = matching.find((s) => s.id === shipmentId);
  } else {
    shipment =
      matching.find((s) => s.status === "IN_TRANSIT") ||
      matching[matching.length - 1];
  }

  if (!shipment) {
    return {
      status: 404,
      error: "SHIPMENT_NOT_FOUND",
      message: `Không tìm thấy chuyến vận chuyển nào liên kết với thùng lạnh '${cleanCode}'.`,
    };
  }

  const shipOrgId = shipment.organizationId || shipment.organization_id;
  if (!isAuthorizedGlobal && shipOrgId !== userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN",
      message: "Bạn không có quyền truy cập dữ liệu vi phạm nhiệt độ của tổ chức khác.",
    };
  }

  const list = inMemoryViolations
    .filter(
      (v) =>
        (v.shipmentId || v.shipment_id) === shipment.id &&
        (v.coldBoxId || v.cold_box_id) === cleanCode
    )
    .sort((a, b) => {
      const tA = new Date(a.startTime || a.start_time).getTime();
      const tB = new Date(b.startTime || b.start_time).getTime();
      return tA - tB;
    });

  return formatViolationsResponse({
    shipmentId: shipment.id,
    coldBoxId: cleanCode,
    organizationId: shipOrgId,
    rawViolations: list,
  });
}

/**
 * Lấy danh sách vi phạm (có phân quyền và lọc đa tổ chức)
 */
async function getViolations(options = {}) {
  const { pool, authContext, shipmentId, coldBoxId, limit = 50, offset = 0 } = options;
  if (shipmentId) {
    return getShipmentViolations({ pool, authContext, shipmentId });
  }
  if (coldBoxId) {
    return getColdBoxViolations({ pool, authContext, coldBoxCode: coldBoxId });
  }

  const isInspector = Boolean(
    authContext?.isInspector || authContext?.roleId === "admin" || authContext?.roleId === "inspector"
  );
  const userOrgId = authContext?.organizationId || authContext?.organization_id;

  if (pool) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (!isInspector && userOrgId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(userOrgId);
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
        startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
        endTime: row.status === "ONGOING" ? null : (row.end_time ? new Date(row.end_time).toISOString() : null),
        peakTemperature: Number(row.peak_temperature),
        durationMinutes: Number(row.duration_minutes),
        status: row.status,
        excursionsCount: row.excursions_count,
        sampleCount: Number(row.details?.readingsCount || row.excursions_count || 1),
        details: typeof row.details === "string" ? JSON.parse(row.details) : row.details,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      })),
    };
  }

  // In-memory fallback
  let list = inMemoryViolations;
  if (!isInspector && userOrgId) {
    list = list.filter((v) => (v.organization_id || v.organizationId) === userOrgId);
  }

  return {
    success: true,
    violations: list.slice(offset, offset + limit),
  };
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
  handleAcceptedTemperatureReading,
  formatViolationsResponse,
  getViolations,
  getShipmentViolations,
  getColdBoxViolations,
  evaluateSeriesDirect,
  recordViolationEventsForShipmentLots,
  finalizeShipmentViolations,
  inMemoryReadings,
  inMemoryViolations,
  streamingDetectors,
};

