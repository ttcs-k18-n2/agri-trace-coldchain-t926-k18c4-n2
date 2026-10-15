/**
 * Test Suite: Story S-60 (N2-131, N2-290, N2-257, N2-258)
 * Bản đồ vị trí vùng trồng và điểm phân phối trên trang truy xuất công khai
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  inMemoryLots,
  inMemoryBatchEvents,
  seedS22Data,
} = require("../src/server");
const {
  getPublicLotMapData,
  resolveRepresentativeArea,
} = require("../src/public_trace_map");

test("S-60 / N2-290 / N2-258: Kiểm thử toàn diện API Bản đồ vị trí vùng trồng và điểm phân phối", async (t) => {
  // Chuẩn bị dữ liệu mẫu chuẩn phả hệ S-22
  seedS22Data();

  await t.test("1. Quyền truy cập: Người tiêu dùng không cần đăng nhập vẫn truy xuất được bản đồ", async () => {
    // Gửi request không có session cookie hay Authorization header
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200, "API công khai phải trả về 200 OK cho người dùng vãng lai");
    assert.ok(res.body.lot, "Phải có thông tin đối tượng lot");
    assert.equal(res.body.lot.code, "LOT-001");
  });

  await t.test("2. Lô một nguồn (Single origin): Hiển thị đúng vùng trồng và hành trình tuyến tính", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const body = res.body;
    // Kiểm tra lot
    assert.equal(body.lot.code, "LOT-001");
    assert.equal(body.lot.isMerged, false, "Lô một nguồn thì isMerged phải là false");
    assert.ok(body.lot.productName, "Phải có tên sản phẩm");

    // Kiểm tra origins
    assert.ok(Array.isArray(body.origins));
    assert.equal(body.origins.length, 1, "Lô một nguồn chỉ có đúng 1 vùng trồng gốc");
    const origin = body.origins[0];
    assert.ok(origin.regionName.includes("Hùng Sơn") || origin.farmName.includes("Hùng Sơn"));
    assert.equal(origin.hasCoordinates, true);
    assert.equal(origin.verified, true);
    assert.ok(origin.coordinates.lat > 0 && origin.coordinates.lng > 0);

    // Kiểm tra journey & routes
    assert.ok(Array.isArray(body.journey));
    assert.ok(body.journey.length >= 2, "Hành trình phải có ít nhất vùng trồng và điểm lưu kho");
    assert.equal(body.journey[0].step, 1);
    assert.equal(body.journey[0].type, "farm");
    assert.equal(body.journey[0].isOrigin, true);

    // Tuyến đường routes
    assert.ok(Array.isArray(body.routes));
    assert.ok(body.routes.length >= 1, "Phải có đường nối các mốc có tọa độ");
    assert.equal(body.routes[0].fromStep, 1);
    assert.equal(body.routes[0].coordinates.length, 2);
  });

  await t.test("3. Bảo vệ dữ liệu & quyền riêng tư nông hộ (S-06 Whitelisting): Tuyệt đối không lộ tọa độ thửa gốc, số điện thoại, mã nội bộ", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const rawJson = JSON.stringify(res.body);

    // 1. Không chứa số điện thoại
    assert.equal(rawJson.includes("0912345678"), false, "Không được chứa số điện thoại quản lý kho/vùng");
    assert.equal(rawJson.includes('"phone":'), false, "Không được có trường phone");
    assert.equal(rawJson.includes('"contactPerson":'), false, "Không được có trường contactPerson");
    assert.equal(rawJson.includes('"contact_person":'), false, "Không được có trường contact_person");

    // 2. Không chứa mã định danh người dùng hay mật khẩu
    assert.equal(rawJson.includes('"actorUserId":'), false, "Không được chứa actorUserId");
    assert.equal(rawJson.includes('"actor_user_id":'), false, "Không được chứa actor_user_id");
    assert.equal(rawJson.includes('"passwordHash":'), false, "Không được chứa passwordHash");
    assert.equal(rawJson.includes('"previous_hash":'), false, "Không được lộ chuỗi băm previous_hash nội bộ");
    assert.equal(rawJson.includes('"event_hash":'), false, "Không được lộ chuỗi băm event_hash nội bộ");

    // 3. Tọa độ vùng trồng là tọa độ đại diện cấp xã, không trùng tọa độ thửa gốc chi tiết
    const origin = res.body.origins[0];
    assert.ok(origin.coordinates);
    assert.equal(typeof origin.coordinates.lat, "number");
    assert.equal(typeof origin.coordinates.lng, "number");
    assert.notEqual(origin.coordinates.lat, 21.5712, "Tọa độ công khai không được trùng tọa độ thửa gốc FARM-002");
    assert.equal(origin.coordinatesString, undefined, "Không để lộ chuỗi tọa độ thửa gốc");

    // 4. Không để lộ ID nội bộ hoặc ghi chú bàn giao
    assert.equal(rawJson.includes("originLotId"), false, "Không để lộ originLotId nội bộ");
  });

  await t.test("4. Lô gộp từ nhiều nguồn (Merged multi-origin): Lấy đủ tất cả vùng trồng gốc và không nối chéo các nguồn", async () => {
    // L07 là lô gộp từ L01 và L03 (từ bộ dữ liệu S-22)
    const res = await request(app).get("/api/public/lots/L07/map");
    assert.equal(res.status, 200);

    const body = res.body;
    assert.equal(body.lot.code, "L07");
    assert.equal(body.lot.isMerged, true, "Lô gộp phải có isMerged = true");

    // Kiểm tra các vùng trồng gốc
    assert.ok(body.origins.length >= 1, "Phải tìm thấy các vùng trồng gốc của lô con");

    // Kiểm tra các routes: Các nguồn gộp không được nối trực tiếp vào nhau
    if (body.routes.length >= 2) {
      for (const r of body.routes) {
        // Đảm bảo không có route nối từ bước 1 sang bước 2 nếu cả hai đều là origin
        const fromStepObj = body.journey.find((s) => s.step === r.fromStep);
        const toStepObj = body.journey.find((s) => s.step === r.toStep);
        if (fromStepObj && toStepObj && fromStepObj.isOrigin && toStepObj.isOrigin) {
          assert.fail("Hai vùng trồng nguồn gộp không được nối dây trực tiếp với nhau!");
        }
      }
    }
  });

  await t.test("5. Thứ tự hành trình di chuyển thực tế từ TRANSFER_CONFIRMED và LOCATION_CHANGED", async () => {
    // Giả lập lô TEST-MOVE-01 có đủ các sự kiện theo thứ tự thời gian
    const testLot = {
      id: "TEST-MOVE-01",
      name: "Lô cải làn Bắc Giang",
      status: "Đang lưu kho",
      organizationId: "org-002",
      farmId: "FARM-101",
      productId: "PROD-VEG",
      createdAt: "2026-10-01T08:00:00.000Z",
    };
    inMemoryLots.push(testLot);

    // Ghi sự kiện chuyển kho và bàn giao
    inMemoryBatchEvents.push(
      {
        id: "evt-test-move-01",
        batchId: "TEST-MOVE-01",
        sequenceNo: 1,
        eventType: "HARVEST_CREATED",
        payload: { farmId: "FARM-101", quantity: 300 },
        organizationId: "org-002",
        occurredAt: "2026-10-01T08:00:00.000Z",
      },
      {
        id: "evt-test-move-02",
        batchId: "TEST-MOVE-01",
        sequenceNo: 2,
        eventType: "TRANSFER_CONFIRMED",
        payload: {
          transferId: "trf-test-01",
          fromOrganizationId: "org-002",
          fromOrganizationName: "HTX Nông nghiệp Bắc Giang",
          toOrganizationId: "org-dist",
          toOrganizationName: "Tổng kho Phân phối Hà Nội",
          notes: "Vận chuyển bằng xe lạnh chuyên dụng 5°C",
        },
        organizationId: "org-dist",
        occurredAt: "2026-10-02T10:00:00.000Z",
      },
      {
        id: "evt-test-move-03",
        batchId: "TEST-MOVE-01",
        sequenceNo: 3,
        eventType: "LOCATION_CHANGED",
        payload: {
          newLocationId: "LOC-STORE-HN-01",
          locationName: "Trung tâm Phân phối & Bán lẻ Cầu Giấy",
          step: "Nhập kho trung tâm phân phối Cầu Giấy",
        },
        organizationId: "org-dist",
        occurredAt: "2026-10-02T14:00:00.000Z",
      }
    );

    const res = await request(app).get("/api/public/lots/TEST-MOVE-01/map");
    assert.equal(res.status, 200);

    const journey = res.body.journey;
    assert.ok(journey.length >= 3, "Phải có ít nhất 3 bước hành trình");

    // Bước 1: Vùng trồng
    assert.equal(journey[0].step, 1);
    assert.equal(journey[0].type, "farm");

    // Bước 2: Bàn giao vận chuyển
    assert.equal(journey[1].step, 2);
    assert.equal(journey[1].type, "transit");
    assert.equal(journey[1].hasCoordinates, false, "Mốc bàn giao không có tọa độ cố định");
    assert.equal(journey[1].verified, false);
    assert.equal(journey[1].description.includes("5°C"), false, "Không lộ ghi chú nội bộ ev.payload.notes");

    // Bước 3: Lưu kho điểm phân phối
    assert.equal(journey[2].step, 3);
    assert.ok(journey[2].title.includes("Cầu Giấy"));
    assert.equal(journey[2].hasCoordinates, true, "Kho Cầu Giấy đã xác minh tọa độ");
    assert.equal(journey[2].verified, true);

    // Thời gian tăng dần
    const t1 = new Date(journey[0].occurredAt).getTime();
    const t2 = new Date(journey[1].occurredAt).getTime();
    const t3 = new Date(journey[2].occurredAt).getTime();
    assert.ok(t1 <= t2, "Thời gian bước 1 phải trước hoặc bằng bước 2");
    assert.ok(t2 <= t3, "Thời gian bước 2 phải trước hoặc bằng bước 3");
  });

  await t.test("6. Lô thiếu tọa độ: Không vẽ marker sai, có thông báo mốc văn bản", async () => {
    // L12 là lô mẫu không có farm trong bộ S-22
    const res = await request(app).get("/api/public/lots/L12/map");
    assert.equal(res.status, 200);

    const body = res.body;
    assert.ok(body.summary.hasUnlocatedStops, "Lô thiếu tọa độ phải có cờ hasUnlocatedStops = true");
    assert.equal(body.routes.length, 0, "Không có tọa độ thì routes phải rỗng, không vẽ đường bừa bãi");
  });

  await t.test("7. Xử lý lỗi 404 khi mã lô không tồn tại", async () => {
    const res = await request(app).get("/api/public/lots/LOT-NOT-FOUND-9999/map");
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "LOT_NOT_FOUND");
    assert.ok(res.body.message.includes("Không tìm thấy thông tin lô hàng"));
  });

  await t.test("8. Xử lý lỗi 400 khi mã lô rỗng hoặc không hợp lệ", async () => {
    const res = await request(app).get("/api/public/lots/%20/map");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "INVALID_LOT_CODE");
  });

  await t.test("9. Xử lý lỗi 422 khi phát hiện chu trình phả hệ", async () => {
    // Tạo quan hệ vòng lặp giả lập: L-CYCLE-A -> L-CYCLE-B -> L-CYCLE-A
    const cycleLots = [
      { id: "L-CYCLE-A", name: "Lô vòng A", organizationId: "org-001" },
      { id: "L-CYCLE-B", name: "Lô vòng B", organizationId: "org-001" },
    ];
    const cycleRels = [
      { parentBatchId: "L-CYCLE-A", childBatchId: "L-CYCLE-B", relationType: "SPLIT" },
      { parentBatchId: "L-CYCLE-B", childBatchId: "L-CYCLE-A", relationType: "SPLIT" },
    ];

    await assert.rejects(
      async () => {
        await getPublicLotMapData({
          lotCode: "L-CYCLE-A",
          inMemoryLots: cycleLots,
          inMemoryBatchRelations: cycleRels,
        });
      },
      (err) => {
        assert.equal(err.name, "CycleDetectedError");
        return true;
      }
    );
  });

  await t.test("10. Hàm giải quyết tọa độ đại diện cấp xã resolveRepresentativeArea", async () => {
    // 1. Khớp từ khóa La Bằng: lấy tọa độ tâm xã độc lập, không trùng thửa gốc
    const farm1 = { name: "Thửa đồi chè La Bằng 01", coordinates: "21.5645, 105.6789" };
    const area1 = await resolveRepresentativeArea(null, farm1);
    assert.equal(area1.hasCoordinates, true);
    assert.ok(area1.regionName.includes("La Bằng"));
    assert.equal(area1.coordinates.lat, 21.558);
    assert.equal(area1.coordinates.lng, 105.672);
    assert.notEqual(area1.coordinates.lat, 21.5645, "Không trùng tọa độ thửa đất riêng tư của nông dân");

    // 2. Nông trại không nằm trong danh mục đại diện cấp xã: tuyệt đối không suy đoán/làm tròn tọa độ thửa
    const farmCustom = { name: "Nông hộ Trần Văn C", coordinates: "21.876543, 106.123456" };
    const areaCustom = await resolveRepresentativeArea(null, farmCustom);
    assert.equal(areaCustom.hasCoordinates, false, "Không có vùng đại diện thì không trả tọa độ");
    assert.equal(areaCustom.coordinates, null);

    // 3. Nông trại không có tọa độ
    const farmNoCoords = { name: "Thửa không định vị", coordinates: "" };
    const areaNoCoords = await resolveRepresentativeArea(null, farmNoCoords);
    assert.equal(areaNoCoords.hasCoordinates, false);
    assert.equal(areaNoCoords.coordinates, null);
  });
});
