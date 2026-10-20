/**
 * Dịch vụ Nén Dữ Liệu Nhiệt Độ Cũ Thành Giá Trị Tổng Hợp Theo Giờ (Story S-51 / Jira N2-114 / Subtask N2-303)
 *
 * Tiêu chuẩn & Quy tắc Nghiệp vụ:
 * 1. Với số đo nhiệt độ cũ hơn 30 ngày: tổng hợp theo từng giờ (date_trunc('hour', recorded_at)).
 * 2. Lưu trữ min_temperature, max_temperature, avg_temperature, và sample_count.
 * 3. Phân nhóm chính xác theo shipment_id và cold_box_id (cảm biến/thùng lạnh).
 * 4. Những khoảng thời gian xảy ra vi phạm chuỗi lạnh (Cold Chain Excursions) được gắn cờ và BẢO LƯU SỐ ĐO THÔ.
 * 5. Job chạy ban đêm ghi log chi tiết số dòng đã gộp và nhật ký vào temperature_aggregation_jobs.
 * 6. Idempotent: chạy nhiều lần không sinh bản ghi trùng (ON CONFLICT uq_shipment_hourly_agg).
 * 7. Transaction và cơ chế Rollback toàn vẹn dữ liệu khi gặp sự cố.
 * 8. Bảo vệ dữ liệu gốc: Tuyệt đối không xóa dữ liệu thô khi chưa có chính sách retention được phê duyệt.
 */

const crypto = require("crypto");

const DEFAULT_CUTOFF_DAYS = 30;

// Bộ nhớ in-memory phục vụ kiểm thử đơn vị độc lập
const inMemoryHourlyAggregates = new Map(); // key: shipmentId__coldBoxId__hourIso -> row
const inMemoryJobLogs = [];

/**
 * Truncate thời gian về đầu giờ (UTC / local timestamp)
 */
function truncateToHour(dateInput) {
  const d = new Date(dateInput);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * Kiểm tra xem một thời điểm số đo có nằm trong bất kỳ khoảng vi phạm nào không
 */
function isReadingInViolation(recordedAt, violations = []) {
  const rTime = new Date(recordedAt).getTime();
  return violations.some((v) => {
    const start = new Date(v.start_time || v.startTime).getTime();
    const end = new Date(v.end_time || v.endTime).getTime();
    return rTime >= start && rTime <= end;
  });
}

/**
 * Kiểm tra xem một khung giờ [bucketHour, bucketHour + 1h) có giao nhau với khoảng vi phạm không
 */
function isHourOverlappingViolation(bucketHour, violations = []) {
  const bStart = new Date(bucketHour).getTime();
  const bEnd = bStart + 3600 * 1000;
  return violations.some((v) => {
    const vStart = new Date(v.start_time || v.startTime).getTime();
    const vEnd = new Date(v.end_time || v.endTime).getTime();
    return vStart < bEnd && vEnd > bStart;
  });
}

/**
 * Thực thi Job nén / tổng hợp dữ liệu nhiệt độ theo giờ
 */
async function runTemperatureHourlyAggregationJob({
  pool = null,
  cutoffDays = DEFAULT_CUTOFF_DAYS,
  now = new Date(),
  inMemoryTemps = null,
  inMemoryViolations = null,
} = {}) {
  const currentTime = now instanceof Date ? now : new Date(now);
  const cutoffTime = new Date(currentTime.getTime() - cutoffDays * 24 * 3600 * 1000);
  const jobId = "job-" + crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  let rawRowsScanned = 0;
  let aggregatedRowsCount = 0;
  let retainedViolationRowsCount = 0;
  let insertedOrUpdatedAggregates = [];

  if (pool && typeof pool.connect === "function") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Đếm tổng số đo thô trước mốc 30 ngày
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM shipment_temperatures WHERE recorded_at < $1`,
        [cutoffTime]
      );
      rawRowsScanned = countRes.rows[0]?.count || 0;

      if (rawRowsScanned > 0) {
        // 2. Tổng hợp theo giờ với phép tính min, max, avg và kiểm tra vi phạm chuỗi lạnh
        const aggQuery = `
          WITH hourly_stats AS (
            SELECT
              st.shipment_id,
              st.cold_box_id,
              date_trunc('hour', st.recorded_at) AS bucket_hour,
              MIN(st.temperature) AS min_temperature,
              MAX(st.temperature) AS max_temperature,
              ROUND(AVG(st.temperature)::numeric, 2) AS avg_temperature,
              COUNT(*)::int AS sample_count,
              BOOL_OR(
                EXISTS (
                  SELECT 1 FROM temperature_violations tv
                  WHERE tv.shipment_id = st.shipment_id
                    AND tv.cold_box_id = st.cold_box_id
                    AND tv.start_time < (date_trunc('hour', st.recorded_at) + INTERVAL '1 hour')
                    AND tv.end_time > date_trunc('hour', st.recorded_at)
                )
              ) AS has_violation
            FROM shipment_temperatures st
            WHERE st.recorded_at < $1
            GROUP BY st.shipment_id, st.cold_box_id, date_trunc('hour', st.recorded_at)
          )
          INSERT INTO shipment_temperature_hourly_aggregates (
            shipment_id,
            cold_box_id,
            bucket_hour,
            min_temperature,
            max_temperature,
            avg_temperature,
            sample_count,
            has_violation,
            raw_retained,
            aggregated_at
          )
          SELECT
            shipment_id,
            cold_box_id,
            bucket_hour,
            min_temperature,
            max_temperature,
            avg_temperature,
            sample_count,
            COALESCE(has_violation, FALSE),
            TRUE,
            NOW()
          FROM hourly_stats
          ON CONFLICT (shipment_id, cold_box_id, bucket_hour)
          DO UPDATE SET
            min_temperature = EXCLUDED.min_temperature,
            max_temperature = EXCLUDED.max_temperature,
            avg_temperature = EXCLUDED.avg_temperature,
            sample_count = EXCLUDED.sample_count,
            has_violation = EXCLUDED.has_violation,
            raw_retained = TRUE,
            aggregated_at = NOW()
          RETURNING id, shipment_id, cold_box_id, bucket_hour, min_temperature, max_temperature, avg_temperature, sample_count, has_violation;
        `;

        const aggRes = await client.query(aggQuery, [cutoffTime]);
        aggregatedRowsCount = aggRes.rowCount || aggRes.rows.length;
        insertedOrUpdatedAggregates = aggRes.rows;

        // 3. Đếm số lượng số đo thô thuộc các khoảng thời gian vi phạm chuỗi lạnh (bắt buộc giữ nguyên số đo thô)
        const violationRawRes = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM shipment_temperatures st
           WHERE st.recorded_at < $1
             AND EXISTS (
               SELECT 1 FROM temperature_violations tv
               WHERE tv.shipment_id = st.shipment_id
                 AND tv.cold_box_id = st.cold_box_id
                 AND tv.start_time <= st.recorded_at
                 AND tv.end_time >= st.recorded_at
             )`,
          [cutoffTime]
        );
        retainedViolationRowsCount = violationRawRes.rows[0]?.count || 0;
      }

      // 4. Ghi nhật ký thực thi job vào bảng temperature_aggregation_jobs
      await client.query(
        `INSERT INTO temperature_aggregation_jobs (
          id, job_type, cutoff_time, raw_rows_scanned, aggregated_rows_count,
          retained_violation_rows_count, status, details, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'SUCCESS', $7, $8, NOW())`,
        [
          jobId,
          "HOURLY_TEMPERATURE_COMPRESSION",
          cutoffTime,
          rawRowsScanned,
          aggregatedRowsCount,
          retainedViolationRowsCount,
          JSON.stringify({
            cutoffDays,
            durationMs: Date.now() - startTime,
            sampleAggregatesCount: insertedOrUpdatedAggregates.length,
          }),
          new Date(startTime),
        ]
      );

      await client.query("COMMIT");
    } catch (dbErr) {
      await client.query("ROLLBACK");
      // Ghi log lỗi vào DB nếu có thể
      try {
        await pool.query(
          `INSERT INTO temperature_aggregation_jobs (
            id, job_type, cutoff_time, raw_rows_scanned, aggregated_rows_count,
            retained_violation_rows_count, status, error_message, started_at, completed_at
          ) VALUES ($1, $2, $3, 0, 0, 0, 'FAILED', $4, $5, NOW())`,
          [
            jobId,
            "HOURLY_TEMPERATURE_COMPRESSION",
            cutoffTime,
            dbErr.message,
            new Date(startTime),
          ]
        );
      } catch {
        /* ignore error log insertion failure */
      }
      console.error("[hourly-temp-aggregation-job] Lỗi thực thi transaction:", dbErr.message);
      throw dbErr;
    } finally {
      client.release();
    }
  } else if (Array.isArray(inMemoryTemps)) {
    // Fallback In-memory phục vụ kiểm thử đơn vị
    const eligibleTemps = inMemoryTemps.filter((t) => {
      const rec = new Date(t.recordedAt || t.recorded_at);
      return rec < cutoffTime;
    });

    rawRowsScanned = eligibleTemps.length;
    const violations = Array.isArray(inMemoryViolations) ? inMemoryViolations : [];

    // Nhóm theo shipment_id, cold_box_id và giờ
    const groups = new Map();
    for (const t of eligibleTemps) {
      const shipmentId = t.shipmentId || t.shipment_id;
      const coldBoxId = t.coldBoxId || t.cold_box_id;
      const rec = new Date(t.recordedAt || t.recorded_at);
      const bHour = truncateToHour(rec);
      const bHourIso = bHour.toISOString();
      const groupKey = `${shipmentId}__${coldBoxId}__${bHourIso}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          shipmentId,
          coldBoxId,
          bucketHour: bHour,
          bucketHourIso: bHourIso,
          readings: [],
        });
      }
      groups.get(groupKey).readings.push(Number(t.temperature));

      if (isReadingInViolation(rec, violations)) {
        retainedViolationRowsCount++;
      }
    }

    for (const group of groups.values()) {
      const temps = group.readings;
      const minTemp = Math.min(...temps);
      const maxTemp = Math.max(...temps);
      const sum = temps.reduce((a, b) => a + b, 0);
      const avgTemp = Number((sum / temps.length).toFixed(2));
      const hasViolation = isHourOverlappingViolation(group.bucketHour, violations);

      const record = {
        id: "thour-" + crypto.randomUUID().slice(0, 8),
        shipment_id: group.shipmentId,
        shipmentId: group.shipmentId,
        cold_box_id: group.coldBoxId,
        coldBoxId: group.coldBoxId,
        bucket_hour: group.bucketHour,
        bucketHour: group.bucketHourIso,
        min_temperature: minTemp,
        minTemperature: minTemp,
        max_temperature: maxTemp,
        maxTemperature: maxTemp,
        avg_temperature: avgTemp,
        avgTemperature: avgTemp,
        sample_count: temps.length,
        sampleCount: temps.length,
        has_violation: hasViolation,
        hasViolation,
        raw_retained: true,
        rawRetained: true,
        aggregated_at: new Date().toISOString(),
      };

      const mapKey = `${group.shipmentId}__${group.coldBoxId}__${group.bucketHourIso}`;
      inMemoryHourlyAggregates.set(mapKey, record);
      insertedOrUpdatedAggregates.push(record);
    }

    aggregatedRowsCount = insertedOrUpdatedAggregates.length;

    inMemoryJobLogs.push({
      id: jobId,
      jobType: "HOURLY_TEMPERATURE_COMPRESSION",
      cutoffTime: cutoffTime.toISOString(),
      rawRowsScanned,
      aggregatedRowsCount,
      retainedViolationRowsCount,
      status: "SUCCESS",
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    });
  }

  const durationMs = Date.now() - startTime;

  // Ghi log chuẩn định dạng theo yêu cầu Jira
  console.log(
    `[hourly-temp-aggregation-job] scanned=${rawRowsScanned} aggregated=${aggregatedRowsCount} retained_violations=${retainedViolationRowsCount} cutoff_days=${cutoffDays} duration_ms=${durationMs}`
  );

  return {
    success: true,
    jobId,
    cutoffTime: cutoffTime.toISOString(),
    rawRowsScanned,
    aggregatedRowsCount,
    retainedViolationRowsCount,
    durationMs,
    aggregates: insertedOrUpdatedAggregates,
  };
}

/**
 * Truy vấn dữ liệu nhiệt độ tổng hợp theo giờ của một chuyến vận chuyển
 */
async function getHourlyAggregatesForShipment({ pool = null, shipmentId, inMemoryMap = inMemoryHourlyAggregates } = {}) {
  if (!shipmentId) return [];

  if (pool) {
    const res = await pool.query(
      `SELECT id, shipment_id, cold_box_id, bucket_hour, min_temperature, max_temperature, avg_temperature, sample_count, has_violation, raw_retained, aggregated_at
       FROM shipment_temperature_hourly_aggregates
       WHERE shipment_id = $1
       ORDER BY bucket_hour ASC`,
      [shipmentId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      shipmentId: r.shipment_id,
      coldBoxId: r.cold_box_id,
      bucketHour: r.bucket_hour ? new Date(r.bucket_hour).toISOString() : null,
      minTemperature: Number(r.min_temperature),
      maxTemperature: Number(r.max_temperature),
      avgTemperature: Number(r.avg_temperature),
      sampleCount: Number(r.sample_count),
      hasViolation: Boolean(r.has_violation),
      rawRetained: Boolean(r.raw_retained),
      aggregatedAt: r.aggregated_at ? new Date(r.aggregated_at).toISOString() : null,
    }));
  }

  const results = [];
  for (const entry of inMemoryMap.values()) {
    if (entry.shipmentId === shipmentId || entry.shipment_id === shipmentId) {
      results.push(entry);
    }
  }
  return results.sort((a, b) => new Date(a.bucketHour || a.bucket_hour) - new Date(b.bucketHour || b.bucket_hour));
}

/**
 * Khởi động lịch chạy tự động ban đêm (Nightly Job Scheduler)
 */
function startNightlyTemperatureAggregationCron({
  pool = null,
  inMemoryTemps = null,
  inMemoryViolations = null,
  intervalMs = 24 * 3600 * 1000,
  cutoffDays = DEFAULT_CUTOFF_DAYS,
} = {}) {
  const timer = setInterval(() => {
    runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays,
      inMemoryTemps,
      inMemoryViolations,
    }).catch((err) => {
      console.error("[hourly-temp-aggregation-job] Lỗi khi chạy job chu kỳ đêm:", err.message);
    });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

module.exports = {
  DEFAULT_CUTOFF_DAYS,
  truncateToHour,
  isReadingInViolation,
  isHourOverlappingViolation,
  runTemperatureHourlyAggregationJob,
  getHourlyAggregatesForShipment,
  startNightlyTemperatureAggregationCron,
  inMemoryHourlyAggregates,
  inMemoryJobLogs,
};
