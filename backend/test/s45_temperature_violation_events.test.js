const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const {
  createShipment,
  completeShipment,
  inMemoryShipments,
  inMemoryShipmentLots,
  inMemoryShipmentTemperatures,
} = require("../src/shipment_service");
const {
  handleAcceptedTemperatureReading,
  recordViolationEventsForShipmentLots,
  inMemoryViolations,
} = require("../src/cold_chain_violation_service");
const {
  appendBatchEvent,
  getBatchEvents,
  inMemoryBatchEvents,
} = require("../src/event_repository");
const { verifyBatchEventChain } = require("../src/integrity_verifier");

function resetInMemory() {
  inMemoryShipments.length = 0;
  inMemoryShipmentLots.length = 0;
  inMemoryShipmentTemperatures.length = 0;
  inMemoryViolations.length = 0;
  inMemoryBatchEvents.length = 0;
}

test("Story S-45 (Jira N2-113): Ghi vi phạm nhiệt độ thành sự kiện vào chuỗi mọi lô trên chuyến", async (t) => {
  t.beforeEach(() => {
    resetInMemory();
  });

  await t.test("Backend N2-221: Khi vi phạm kết thúc, mọi lô thuộc chuyến đều có sự kiện TEMPERATURE_VIOLATION", async () => {
    const orgId = "org-farm-01";
    const authContext = { userId: "usr-01", organizationId: orgId, roleId: "producer" };
    const baseTime = Date.parse("2026-10-17T08:00:00.000Z");

    // 1. Tạo 2 lô hàng thuộc chuyến và 1 lô độc lập không thuộc chuyến
    const lot1 = { id: "LOT-S45-01", name: "Rau sạch 01", organizationId: orgId, initialQuantity: 100, remainingQuantity: 100, status: "Đã thu hoạch" };
    const lot2 = { id: "LOT-S45-02", name: "Rau sạch 02", organizationId: orgId, initialQuantity: 200, remainingQuantity: 200, status: "Đã thu hoạch" };
    const lotOther = { id: "LOT-S45-OTHER", name: "Lô khác", organizationId: orgId, initialQuantity: 50, remainingQuantity: 50, status: "Đã thu hoạch" };

    const inMemoryLots = [lot1, lot2, lotOther];

    // Ghi sự kiện khởi tạo lô (HARVEST_CREATED)
    await appendBatchEvent(null, {
      batchId: lot1.id,
      eventType: "HARVEST_CREATED",
      payload: { lotName: lot1.name },
      organizationId: orgId,
      occurredAt: new Date(baseTime).toISOString(),
    });
    await appendBatchEvent(null, {
      batchId: lot2.id,
      eventType: "HARVEST_CREATED",
      payload: { lotName: lot2.name },
      organizationId: orgId,
      occurredAt: new Date(baseTime).toISOString(),
    });
    await appendBatchEvent(null, {
      batchId: lotOther.id,
      eventType: "HARVEST_CREATED",
      payload: { lotName: lotOther.name },
      organizationId: orgId,
      occurredAt: new Date(baseTime).toISOString(),
    });

    // 2. Mở chuyến vận chuyển gắn 2 lô lot1 và lot2
    const shipRes = await createShipment({
      authContext,
      data: {
        coldBoxId: "BOX-S45-01",
        lotIds: [lot1.id, lot2.id],
        vehiclePlate: "29C-12345",
        driverName: "Tài xế Nguyễn Văn A",
        driverPhone: "0912345678",
        startedAt: new Date(baseTime).toISOString(),
      },
      inMemoryLots,
    });

    assert.equal(shipRes.status, 201, "Tạo chuyến vận chuyển thành công");
    const shipment = shipRes.shipment;
    assert.equal(shipment.lotIds.length, 2, "Chuyến gắn đúng 2 lô hàng");

    // 3. Mô phỏng đợt vi phạm nhiệt độ > 8°C kéo dài 45 phút (AC1 S-43)
    // Phút 0: 4°C
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 4.0,
      recordedAt: new Date(baseTime).toISOString(),
    });
    // Phút 10: 9.0°C (bắt đầu vượt)
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 9.0,
      recordedAt: new Date(baseTime + 10 * 60000).toISOString(),
    });
    // Phút 30: 14.5°C (đỉnh nhiệt độ)
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 14.5,
      recordedAt: new Date(baseTime + 30 * 60000).toISOString(),
    });
    // Phút 55: 9.2°C (vẫn đang vượt, tổng thời gian 45 phút)
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 9.2,
      recordedAt: new Date(baseTime + 55 * 60000).toISOString(),
    });

    // Lúc này vi phạm đang diễn ra (ONGOING), chưa kết thúc -> Chưa được ghi vào chuỗi lô
    const eventsLot1During = await getBatchEvents(null, lot1.id);
    const violEventsDuring = eventsLot1During.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    assert.equal(violEventsDuring.length, 0, "Chưa ghi vi phạm khi đợt vượt ngưỡng chưa kết thúc");

    // Phút 56: Nhiệt độ hạ về 4.0°C (kết thúc đợt vượt ngưỡng)
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 4.0,
      recordedAt: new Date(baseTime + 56 * 60000).toISOString(),
    });

    // Phút 62: Qua 5 phút gap (6 phút từ lúc về an toàn), vi phạm chính thức RESOLVED!
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-S45-01",
      temperature: 3.8,
      recordedAt: new Date(baseTime + 62 * 60000).toISOString(),
    });

    // 4. Kiểm tra sự kiện TEMPERATURE_VIOLATION xuất hiện trên TẤT CẢ các lô thuộc chuyến
    const eventsLot1 = await getBatchEvents(null, lot1.id);
    const eventsLot2 = await getBatchEvents(null, lot2.id);
    const eventsLotOther = await getBatchEvents(null, lotOther.id);

    const viol1 = eventsLot1.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    const viol2 = eventsLot2.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    const violOther = eventsLotOther.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");

    assert.equal(viol1.length, 1, "Lô 1 phải có đúng 1 sự kiện TEMPERATURE_VIOLATION");
    assert.equal(viol2.length, 1, "Lô 2 phải có đúng 1 sự kiện TEMPERATURE_VIOLATION");
    assert.equal(violOther.length, 0, "Lô ngoài chuyến tuyệt đối không bị ảnh hưởng");

    // 5. Kiểm tra đầy đủ thông tin sự kiện theo Jira N2-221
    const p1 = viol1[0].payload;
    const p2 = viol2[0].payload;
    assert.equal(p1.violationId, p2.violationId, "Mã vi phạm phải thống nhất giữa các lô");
    assert.equal(p1.shipmentId, shipment.id, "Phải lưu mã chuyến shipmentId");
    assert.equal(p1.coldBoxId, "BOX-S45-01", "Phải lưu mã thùng lạnh coldBoxId");
    assert.equal(p1.peakTemperature, 14.5, "Nhiệt độ đỉnh phải là 14.5°C");
    assert.equal(p1.durationMinutes, 45, "Thời lượng phải là 45 phút");
    assert.equal(p1.status, "RESOLVED", "Trạng thái vi phạm là RESOLVED");
    assert.ok(p1.startTime, "Phải lưu thời điểm bắt đầu");
    assert.ok(p1.endTime, "Phải lưu thời điểm kết thúc");

    // 6. Kiểm tra toàn vẹn chuỗi hash-chain
    const integrity1 = verifyBatchEventChain(eventsLot1);
    const integrity2 = verifyBatchEventChain(eventsLot2);
    assert.equal(integrity1.valid, true, "Chuỗi sự kiện của Lô 1 phải toàn vẹn");
    assert.equal(integrity2.valid, true, "Chuỗi sự kiện của Lô 2 phải toàn vẹn");
  });

  await t.test("Backend N2-221: Tính luỹ kế (Idempotency) - không ghi trùng khi nhận lại sự kiện", async () => {
    const orgId = "org-coop-01";
    const shipment = { id: "shp-test-idem", code: "shp-test-idem", coldBoxId: "BOX-IDEM", organizationId: orgId };
    const lotId = "LOT-IDEM-01";

    inMemoryShipmentLots.push({
      id: "shplot-idem",
      shipmentId: shipment.id,
      lotId,
      lotOrgId: orgId,
      isActive: true,
    });

    const violation = {
      id: "viol-idem-12345",
      threshold: 8.0,
      startTime: "2026-10-17T08:10:00.000Z",
      endTime: "2026-10-17T08:55:00.000Z",
      peakTemperature: 15.2,
      durationMinutes: 45,
      durationSeconds: 2700,
      rule: "Vượt ngưỡng > 30 phút",
      status: "RESOLVED",
    };

    // Lần 1: Ghi nhận sự kiện vi phạm
    const firstRun = await recordViolationEventsForShipmentLots({
      dbClient: null,
      shipment,
      violation,
      coldBoxId: "BOX-IDEM",
      organizationId: orgId,
    });
    assert.equal(firstRun.length, 1, "Lần đầu phải tạo 1 sự kiện");

    // Lần 2: Ghi nhận lại cùng vi phạm (mô phỏng retry hoặc đọc lại số đo)
    const secondRun = await recordViolationEventsForShipmentLots({
      dbClient: null,
      shipment,
      violation,
      coldBoxId: "BOX-IDEM",
      organizationId: orgId,
    });
    assert.equal(secondRun.length, 0, "Lần 2 phải nhận diện đã ghi và bỏ qua không ghi trùng");

    const events = await getBatchEvents(null, lotId);
    const violEvents = events.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    assert.equal(violEvents.length, 1, "Tổng số sự kiện vi phạm trên lô chỉ là 1, không bị nhân đôi");
  });

  await t.test("Tester N2-222: Chuyến hoàn tất khi vi phạm chưa hạ nhiệt sẽ được chốt tự động và ghi vào lô", async () => {
    const orgId = "org-test-01";
    const authContext = { userId: "usr-01", organizationId: orgId, roleId: "producer" };
    const baseTime = Date.parse("2026-10-17T08:00:00.000Z");

    const lot = { id: "LOT-FINAL-01", name: "Nho Ninh Thuận", organizationId: orgId, initialQuantity: 50, remainingQuantity: 50, status: "Đã thu hoạch" };
    const inMemoryLots = [lot];

    await appendBatchEvent(null, {
      batchId: lot.id,
      eventType: "HARVEST_CREATED",
      payload: { lotName: lot.name },
      organizationId: orgId,
      occurredAt: new Date(baseTime).toISOString(),
    });

    const shipRes = await createShipment({
      authContext,
      data: {
        coldBoxId: "BOX-FINAL-01",
        lotIds: [lot.id],
        vehiclePlate: "51D-99999",
        startedAt: new Date(baseTime).toISOString(),
      },
      inMemoryLots,
    });
    const shipment = shipRes.shipment;

    // Vi phạm > 30 phút nhưng xe đến nơi và tài xế bấm kết thúc chuyến ngay lúc còn đang nóng
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-FINAL-01",
      temperature: 12.5,
      recordedAt: new Date(baseTime + 10 * 60000).toISOString(),
    });
    await handleAcceptedTemperatureReading({
      shipment,
      coldBoxId: "BOX-FINAL-01",
      temperature: 16.0,
      recordedAt: new Date(baseTime + 45 * 60000).toISOString(),
    });

    // Kết thúc chuyến
    const compRes = await completeShipment({
      authContext,
      shipmentId: shipment.id,
    });
    assert.equal(compRes.status, 200, "Kết thúc chuyến thành công");

    // Kiểm tra vi phạm đã được finalize và ghi vào chuỗi của lô
    const lotEvents = await getBatchEvents(null, lot.id);
    const violEvents = lotEvents.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");
    assert.equal(violEvents.length, 1, "Vi phạm phải được finalize và ghi nhận khi chuyến kết thúc");
    assert.equal(violEvents[0].payload.peakTemperature, 16.0, "Đỉnh nhiệt độ là 16.0°C");

    const chainCheck = verifyBatchEventChain(lotEvents);
    assert.equal(chainCheck.valid, true, "Chuỗi sự kiện toàn vẹn sau khi kết thúc chuyến");
  });

  // Kiểm thử với PostgreSQL thật nếu có cấu hình disposable DB
  const pgConnectionString = process.env.DATABASE_URL || "postgresql://postgres:app_password@127.0.0.1:50438/agy_campaign_test";
  const canRunPg = process.env.CONFIRMED_DISPOSABLE_DB === "true";

  if (canRunPg) {
    await t.test("PostgreSQL Real DB: Kiểm tra tính nguyên tử, hash-chain và idempotency trên CSDL thật", async () => {
      const pool = new Pool({ connectionString: pgConnectionString });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const orgId = "org-pg-s45";
        const lotId1 = "LOT-PG-S45-1";
        const lotId2 = "LOT-PG-S45-2";
        const shipmentId = "shp-pg-s45";
        const coldBoxId = "BOX-PG-S45";

        // Seed dữ liệu tạm thời trong transaction
        await client.query(
          `INSERT INTO organizations (id, name, type, created_at) 
           VALUES ($1, 'Tổ chức PG S45', 'producer', NOW()) 
           ON CONFLICT (id) DO NOTHING`,
          [orgId]
        );

        await client.query(
          `INSERT INTO lots (id, name, organization_id, status, created_at)
           VALUES ($1, 'Lô PG 1', $3, 'Đã thu hoạch', NOW()),
                  ($2, 'Lô PG 2', $3, 'Đã thu hoạch', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [lotId1, lotId2, orgId]
        );

        await client.query(
          `INSERT INTO shipments (id, cold_box_id, organization_id, status, vehicle_plate, created_at, updated_at)
           VALUES ($1, $2, $3, 'IN_TRANSIT', '29A-PG-01', NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [shipmentId, coldBoxId, orgId]
        );

        await client.query(
          `INSERT INTO shipment_lots (id, shipment_id, lot_id, is_active, status, created_at)
           VALUES ('shplot-pg-1', $1, $2, TRUE, 'LOADED', NOW()),
                  ('shplot-pg-2', $1, $3, TRUE, 'LOADED', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [shipmentId, lotId1, lotId2]
        );

        const violation = {
          id: "viol-pg-999",
          threshold: 8.0,
          startTime: "2026-10-17T09:00:00.000Z",
          endTime: "2026-10-17T09:45:00.000Z",
          peakTemperature: 15.5,
          durationMinutes: 45,
          durationSeconds: 2700,
          rule: "Vượt ngưỡng > 30 phút",
          status: "RESOLVED",
        };

        const shipmentObj = { id: shipmentId, cold_box_id: coldBoxId, organization_id: orgId };

        // Ghi vi phạm vào các lô qua client transaction
        const ev1 = await recordViolationEventsForShipmentLots({
          dbClient: client,
          shipment: shipmentObj,
          violation,
          coldBoxId,
          organizationId: orgId,
        });
        assert.equal(ev1.length, 2, "Phải ghi nhận sự kiện cho cả 2 lô trên PostgreSQL");

        // Gọi lại để kiểm tra Idempotency trên PostgreSQL
        const ev2 = await recordViolationEventsForShipmentLots({
          dbClient: client,
          shipment: shipmentObj,
          violation,
          coldBoxId,
          organizationId: orgId,
        });
        assert.equal(ev2.length, 0, "Không được ghi trùng sự kiện trên PostgreSQL");

        // Lấy sự kiện và kiểm tra hash-chain từ bảng batch_events
        const events1Res = await client.query(
          `SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC`,
          [lotId1]
        );
        const events2Res = await client.query(
          `SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC`,
          [lotId2]
        );

        const integrity1 = verifyBatchEventChain(events1Res.rows.map((r) => ({
          ...r,
          batchId: r.batch_id,
          sequenceNo: r.sequence_no,
          eventType: r.event_type,
          eventHash: r.event_hash,
          previousHash: r.previous_hash,
          occurredAt: r.occurred_at,
          payload: r.payload,
        })));
        assert.equal(integrity1.valid, true, "Hash chain trên PostgreSQL của Lô 1 phải hợp lệ");

        const integrity2 = verifyBatchEventChain(events2Res.rows.map((r) => ({
          ...r,
          batchId: r.batch_id,
          sequenceNo: r.sequence_no,
          eventType: r.event_type,
          eventHash: r.event_hash,
          previousHash: r.previous_hash,
          occurredAt: r.occurred_at,
          payload: r.payload,
        })));
        assert.equal(integrity2.valid, true, "Hash chain trên PostgreSQL của Lô 2 phải hợp lệ");

        await client.query("ROLLBACK");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
        await pool.end();
      }
    });
  }
});
