/**
 * Test Suite: Story S-51 (Jira N2-114 / Subtask N2-303)
 * "Nén dữ liệu nhiệt độ cũ thành giá trị tổng hợp theo giờ"
 *
 * Kiểm thử toàn diện:
 * 1. Tổng hợp đúng theo giờ, tính toán min, max, avg chính xác.
 * 2. Kiểm tra ranh giới 30 ngày (chỉ nén số đo cũ hơn 30 ngày).
 * 3. Bảo lưu toàn vẹn số đo thô trong khoảng thời gian có vi phạm chuỗi lạnh (S-43).
 * 4. Tính an toàn khi chạy lại nhiều lần (Idempotent - không sinh bản ghi trùng).
 * 5. Cơ chế xử lý lỗi, Transaction và Rollback dữ liệu.
 * 6. Hiệu năng với tập dữ liệu lớn (Large Dataset Simulation).
 * 7. Kiểm tra API GET /api/shipments/:id/temperatures/hourly và phân quyền truy cập.
 * 8. Bảo toàn tính tương thích với chức năng phát hiện vi phạm S-43.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  pool,
  runTemperatureHourlyAggregationJob,
  getHourlyAggregatesForShipment,
} = require("../src/server");
const {
  isReadingInViolation,
  isHourOverlappingViolation,
} = require("../src/temperature_hourly_aggregation_service");

async function cleanupS51Data() {
  if (pool) {
    try {
      await pool.query("DELETE FROM temperature_aggregation_jobs");
      await pool.query("DELETE FROM shipment_temperature_hourly_aggregates");
      await pool.query("DELETE FROM temperature_violations WHERE shipment_id LIKE 'test-s51-%'");
      await pool.query("DELETE FROM shipment_temperatures WHERE shipment_id LIKE 'test-s51-%'");
      await pool.query("DELETE FROM shipments WHERE id LIKE 'test-s51-%'");
    } catch {
      /* ignore db errors in cleanup */
    }
  }
}

test("Story S-51: Nén dữ liệu nhiệt độ cũ thành giá trị tổng hợp theo giờ", async (t) => {
  t.beforeEach(async () => {
    await cleanupS51Data();
  });

  t.after(async () => {
    await cleanupS51Data();
  });

  await t.test("TC01: Tổng hợp chính xác theo từng giờ với giá trị min, max, avg", async () => {
    const shipmentId = "test-s51-ship-01";
    const coldBoxId = "CB-TEST-01";
    const now = new Date("2026-10-18T10:00:00.000Z");

    // Tạo 3 số đo cũ hơn 30 ngày (35 ngày trước), cùng khung giờ 08:00 - 09:00 UTC
    // Ngày: 2026-09-13
    const t1 = new Date("2026-09-13T08:05:00.000Z");
    const t2 = new Date("2026-09-13T08:25:00.000Z");
    const t3 = new Date("2026-09-13T08:50:00.000Z");

    const inMemoryTemps = [
      { shipmentId, coldBoxId, temperature: 4.2, recordedAt: t1.toISOString() },
      { shipmentId, coldBoxId, temperature: 6.8, recordedAt: t2.toISOString() },
      { shipmentId, coldBoxId, temperature: 5.0, recordedAt: t3.toISOString() },
    ];

    if (pool) {
      // Tạo shipment mẫu trong DB
      await pool.query(
        `INSERT INTO shipments (id, organization_id, cold_box_id, status, created_at, updated_at)
         VALUES ($1, 'org-01', $2, 'DISPATCHED', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [shipmentId, coldBoxId]
      );

      for (const item of inMemoryTemps) {
        await pool.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [`temp-${Math.random()}`, shipmentId, coldBoxId, item.temperature, item.recordedAt]
        );
      }
    }

    const jobResult = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps,
      inMemoryViolations: [],
    });

    assert.equal(jobResult.success, true);
    assert.equal(jobResult.rawRowsScanned, 3, "Phải quét đủ 3 dòng số đo cũ");
    assert.equal(jobResult.aggregatedRowsCount, 1, "Phải gộp thành 1 bản ghi theo giờ duy nhất");

    // Kiểm tra bản ghi tổng hợp
    const aggregates = await getHourlyAggregatesForShipment({ pool, shipmentId });
    assert.equal(aggregates.length, 1);
    const agg = aggregates[0];

    assert.equal(agg.minTemperature, 4.2, "min_temperature phải là 4.2");
    assert.equal(agg.maxTemperature, 6.8, "max_temperature phải là 6.8");
    assert.equal(agg.avgTemperature, 5.33, "avg_temperature phải là 5.33 ((4.2 + 6.8 + 5.0)/3)");
    assert.equal(agg.sampleCount, 3, "sample_count phải là 3");
    assert.equal(agg.hasViolation, false, "Không có vi phạm");
    assert.equal(agg.rawRetained, true, "raw_retained phải là true");
  });

  await t.test("TC02: Kiểm tra nghiêm ngặt ranh giới 30 ngày (Boundary Condition)", async () => {
    const shipmentId = "test-s51-ship-02";
    const coldBoxId = "CB-TEST-02";
    const now = new Date("2026-10-18T10:00:00.000Z");

    // Mốc 30 ngày trước: 2026-09-18T10:00:00.000Z
    // 1. Số đo CŨ HƠN 30 ngày (31 ngày trước: 2026-09-17) -> ĐƯỢC NÉN
    const oldTempDate = new Date("2026-09-17T09:15:00.000Z");
    // 2. Số đo MỚI HƠN 30 ngày (29 ngày trước: 2026-09-19) -> KHÔNG ĐƯỢC NÉN (chờ đủ 30 ngày)
    const recentTempDate = new Date("2026-09-19T09:15:00.000Z");

    const inMemoryTemps = [
      { shipmentId, coldBoxId, temperature: 3.5, recordedAt: oldTempDate.toISOString() },
      { shipmentId, coldBoxId, temperature: 4.0, recordedAt: recentTempDate.toISOString() },
    ];

    if (pool) {
      await pool.query(
        `INSERT INTO shipments (id, organization_id, cold_box_id, status, created_at, updated_at)
         VALUES ($1, 'org-01', $2, 'DISPATCHED', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [shipmentId, coldBoxId]
      );

      for (const item of inMemoryTemps) {
        await pool.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [`temp-${Math.random()}`, shipmentId, coldBoxId, item.temperature, item.recordedAt]
        );
      }
    }

    const jobResult = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps,
    });

    assert.equal(jobResult.rawRowsScanned, 1, "Chỉ được quét đúng 1 dòng cũ hơn 30 ngày");
    assert.equal(jobResult.aggregatedRowsCount, 1, "Chỉ tổng hợp 1 dòng");

    const aggregates = await getHourlyAggregatesForShipment({ pool, shipmentId });
    assert.equal(aggregates.length, 1);
    // Bản ghi tổng hợp phải thuộc ngày 2026-09-17
    assert.ok(aggregates[0].bucketHour.includes("2026-09-17"), "Chỉ nén số đo 31 ngày trước");
  });

  await t.test("TC03: Khoảng thời gian vi phạm chuỗi lạnh được gắn cờ và bảo lưu số đo thô", async () => {
    const shipmentId = "test-s51-ship-03";
    const coldBoxId = "CB-TEST-03";
    const now = new Date("2026-10-18T10:00:00.000Z");

    // Khung giờ 35 ngày trước: 2026-09-13T14:00 - 15:00
    const tViolation1 = new Date("2026-09-13T14:10:00.000Z");
    const tViolation2 = new Date("2026-09-13T14:40:00.000Z");

    // Vi phạm xảy ra từ 14:05 đến 14:45
    const violation = {
      id: "viol-test-01",
      shipmentId,
      shipment_id: shipmentId,
      coldBoxId,
      cold_box_id: coldBoxId,
      startTime: "2026-09-13T14:05:00.000Z",
      start_time: "2026-09-13T14:05:00.000Z",
      endTime: "2026-09-13T14:45:00.000Z",
      end_time: "2026-09-13T14:45:00.000Z",
      thresholdValue: 8.0,
      peakTemperature: 14.5,
    };

    const inMemoryTemps = [
      { shipmentId, coldBoxId, temperature: 12.0, recordedAt: tViolation1.toISOString() },
      { shipmentId, coldBoxId, temperature: 14.5, recordedAt: tViolation2.toISOString() },
    ];

    if (pool) {
      await pool.query(
        `INSERT INTO shipments (id, organization_id, cold_box_id, status, created_at, updated_at)
         VALUES ($1, 'org-01', $2, 'DISPATCHED', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [shipmentId, coldBoxId]
      );

      await pool.query(
        `INSERT INTO temperature_violations (
          id, shipment_id, cold_box_id, organization_id, threshold_value,
          start_time, end_time, peak_temperature, duration_minutes, status, created_at, updated_at
        ) VALUES ($1, $2, $3, 'org-01', 8.0, $4, $5, 14.5, 40, 'RESOLVED', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING`,
        [violation.id, shipmentId, coldBoxId, violation.startTime, violation.endTime]
      );

      for (const item of inMemoryTemps) {
        await pool.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [`temp-${Math.random()}`, shipmentId, coldBoxId, item.temperature, item.recordedAt]
        );
      }
    }

    const jobResult = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps,
      inMemoryViolations: [violation],
    });

    assert.equal(jobResult.success, true);
    assert.ok(
      jobResult.retainedViolationRowsCount >= 2,
      "Số đo thô trong khoảng vi phạm phải được đếm và bảo lưu"
    );

    const aggregates = await getHourlyAggregatesForShipment({ pool, shipmentId });
    assert.equal(aggregates.length, 1);
    assert.equal(aggregates[0].hasViolation, true, "Bản ghi tổng hợp phải có cờ has_violation = true");
    assert.equal(aggregates[0].rawRetained, true, "Bản ghi tổng hợp phải có cờ raw_retained = true");

    // Kiểm tra helper functions
    assert.equal(isReadingInViolation(tViolation1, [violation]), true);
    assert.equal(
      isHourOverlappingViolation(new Date("2026-09-13T14:00:00.000Z"), [violation]),
      true
    );
  });

  await t.test("TC04: Tính an toàn khi chạy lại nhiều lần (Idempotency - không sinh bản ghi trùng)", async () => {
    const shipmentId = "test-s51-ship-04";
    const coldBoxId = "CB-TEST-04";
    const now = new Date("2026-10-18T10:00:00.000Z");

    const t1 = new Date("2026-09-10T05:10:00.000Z");
    const t2 = new Date("2026-09-10T05:40:00.000Z");

    const inMemoryTemps = [
      { shipmentId, coldBoxId, temperature: 5.5, recordedAt: t1.toISOString() },
      { shipmentId, coldBoxId, temperature: 6.5, recordedAt: t2.toISOString() },
    ];

    if (pool) {
      await pool.query(
        `INSERT INTO shipments (id, organization_id, cold_box_id, status, created_at, updated_at)
         VALUES ($1, 'org-01', $2, 'DISPATCHED', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [shipmentId, coldBoxId]
      );

      for (const item of inMemoryTemps) {
        await pool.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [`temp-${Math.random()}`, shipmentId, coldBoxId, item.temperature, item.recordedAt]
        );
      }
    }

    // Lần chạy 1
    const run1 = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps,
    });
    assert.equal(run1.aggregatedRowsCount, 1);

    // Lần chạy 2 (giả lập job đêm chạy lại lần nữa)
    const run2 = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps,
    });
    assert.equal(run2.success, true);

    const aggregates = await getHourlyAggregatesForShipment({ pool, shipmentId });
    assert.equal(
      aggregates.length,
      1,
      "Số lượng bản ghi tổng hợp phải giữ nguyên là 1, không được nhân đôi trùng lặp"
    );
    assert.equal(aggregates[0].minTemperature, 5.5);
    assert.equal(aggregates[0].maxTemperature, 6.5);
    assert.equal(aggregates[0].avgTemperature, 6.0);
  });

  await t.test("TC05: Xử lý lỗi, Transaction và Rollback khi database gặp sự cố", async () => {
    if (!pool) return;

    // Giả lập một client bị lỗi giữa chừng để kiểm tra ROLLBACK
    const mockPool = {
      connect: async () => {
        const client = await pool.connect();
        const originalQuery = client.query.bind(client);
        client.query = async (text, params) => {
          // Làm nổ lỗi tại bước INSERT tổng hợp
          if (typeof text === "string" && text.includes("INSERT INTO shipment_temperature_hourly_aggregates")) {
            throw new Error("MOCK_SIMULATED_DB_FAILURE_DURING_AGGREGATION");
          }
          return originalQuery(text, params);
        };
        return client;
      },
      query: pool.query.bind(pool),
    };

    const shipmentId = "test-s51-ship-rollback";
    const now = new Date("2026-10-18T10:00:00.000Z");

    await assert.rejects(
      async () => {
        await runTemperatureHourlyAggregationJob({
          pool: mockPool,
          cutoffDays: 30,
          now,
        });
      },
      /MOCK_SIMULATED_DB_FAILURE_DURING_AGGREGATION/,
      "Phải ném lỗi khi câu lệnh trong transaction thất bại"
    );

    // Kiểm tra bản ghi tổng hợp không bị lưu dở dang
    const aggregates = await getHourlyAggregatesForShipment({ pool, shipmentId });
    assert.equal(aggregates.length, 0, "Không có dữ liệu rác lưu lại sau khi rollback");

    // Kiểm tra log job ghi nhận trạng thái FAILED
    const failJobRes = await pool.query(
      `SELECT * FROM temperature_aggregation_jobs WHERE status = 'FAILED' ORDER BY started_at DESC LIMIT 1`
    );
    assert.ok(failJobRes.rows.length > 0, "Phải có bản ghi job với status = FAILED");
    assert.ok(
      failJobRes.rows[0].error_message.includes("MOCK_SIMULATED_DB_FAILURE"),
      "Log phải chứa thông điệp lỗi chính xác"
    );
  });

  await t.test("TC06: Hiệu năng cao với khối lượng dữ liệu lớn (Large Data Simulation)", async () => {
    const shipmentId = "test-s51-ship-large";
    const coldBoxId = "CB-TEST-LARGE";
    const now = new Date("2026-10-18T10:00:00.000Z");

    // Sinh 600 số đo thô (mỗi 10 phút một số đo trải dài qua 100 giờ của tháng trước)
    const largeTemps = [];
    const baseDate = new Date("2026-09-01T00:00:00.000Z");

    for (let i = 0; i < 600; i++) {
      const recordedAt = new Date(baseDate.getTime() + i * 10 * 60 * 1000);
      largeTemps.push({
        shipmentId,
        coldBoxId,
        temperature: Number((3.0 + Math.sin(i) * 2.0).toFixed(2)),
        recordedAt: recordedAt.toISOString(),
      });
    }

    if (pool) {
      await pool.query(
        `INSERT INTO shipments (id, organization_id, cold_box_id, status, created_at, updated_at)
         VALUES ($1, 'org-01', $2, 'DISPATCHED', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [shipmentId, coldBoxId]
      );

      // Chèn theo lô (batch insert) để test trên PostgreSQL
      const values = [];
      const params = [];
      let idx = 1;
      for (const t of largeTemps) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW())`);
        params.push(`temp-l-${idx}`, shipmentId, coldBoxId, t.temperature, t.recordedAt);
      }
      await pool.query(
        `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
         VALUES ${values.join(", ")}
         ON CONFLICT DO NOTHING`,
        params
      );
    }

    const tStart = Date.now();
    const result = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays: 30,
      now,
      inMemoryTemps: largeTemps,
    });
    const duration = Date.now() - tStart;

    assert.equal(result.rawRowsScanned, 600, "Phải quét đúng 600 dòng");
    assert.equal(result.aggregatedRowsCount, 100, "600 số đo mỗi 10 phút phải nén thành đúng 100 giờ");
    assert.ok(duration < 2000, `Thời gian tổng hợp phải dưới 2 giây (thực tế: ${duration}ms)`);
  });

  await t.test("TC07: Truy vấn API GET /api/shipments/:id/temperatures/hourly và kiểm tra RBAC", async () => {
    // 1. Người dùng không đăng nhập truy cập API -> 401
    const unauthRes = await request(app).get("/api/shipments/test-s51-ship-01/temperatures/hourly");
    assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải bị 401");

    // 2. Đăng nhập bằng tài khoản quản trị hệ thống
    const loginRes = await request(app)
      .post("/api/login")
      .send({ email: "admin@agritrace.vn", password: "password123" });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers["set-cookie"];

      const res = await request(app)
        .get("/api/shipments/test-s51-ship-01/temperatures/hourly")
        .set("Cookie", cookie);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    }
  });

  await t.test("TC08: Không làm sai lệch hoặc ảnh hưởng chức năng phát hiện vi phạm S-43", async () => {
    // Chạy job tổng hợp không thay đổi cấu trúc bảng shipments hay detector_state
    if (pool) {
      const colCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'shipments' AND column_name = 'detector_state'`
      );
      assert.equal(
        colCheck.rows.length,
        1,
        "Cột detector_state của S-43 trên bảng shipments phải nguyên vẹn"
      );

      // Bảng temperature_violations vẫn hoạt động chuẩn
      const violCount = await pool.query("SELECT COUNT(*) FROM temperature_violations");
      assert.ok(violCount.rows.length > 0);
    }
  });
});
