/**
 * Test Suite: Story S-48
 * "Trang công khai chỉ trả về trường được đánh dấu công khai"
 * (Public endpoints strictly return only whitelisted public fields)
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
  sanitizePublicTracePayload,
  getPublicLotMapData,
} = require("../src/public_trace_map");

test("Story S-48: Trang công khai chỉ trả về trường được đánh dấu công khai (Whitelisting)", async (t) => {
  // Chuẩn bị dữ liệu mẫu chuẩn phả hệ S-22
  seedS22Data();

  await t.test("TC01: Các endpoint công khai hoạt động không cần đăng nhập", async () => {
    const endpoints = [
      "/api/public/lots/LOT-001",
      "/api/public/lots/LOT-001/map",
      "/api/public/lots/LOT-001/public-map",
      "/api/public/lots/LOT-001/trace",
    ];

    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      assert.equal(res.status, 200, `${ep} phải trả về HTTP 200 cho người dùng vãng lai`);
      assert.ok(res.body.lot, `${ep} phải trả về đối tượng lot`);
      assert.equal(res.body.lot.code, "LOT-001");
    }
  });

  await t.test("TC02: Đối tượng lot chỉ chứa các trường được phép công khai", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    const allowedKeys = new Set([
      "code",
      "name",
      "status",
      "productName",
      "productUnit",
      "organizationName",
      "harvestedAt",
      "isMerged",
      "recall",
      "coldChain",
      "safetyStatus",
    ]);

    for (const key of Object.keys(lot)) {
      assert.ok(
        allowedKeys.has(key),
        `Trường '${key}' trên đối tượng lot không nằm trong danh mục công khai cho phép!`
      );
    }

    // Kiểm tra tuyệt đối không có các trường nội bộ nhạy cảm
    assert.equal(lot.organizationId, undefined, "Không được chứa organizationId");
    assert.equal(lot.farmId, undefined, "Không được chứa farmId");
    assert.equal(lot.productId, undefined, "Không được chứa productId");
    assert.equal(lot.locationId, undefined, "Không được chứa locationId");
    assert.equal(lot.parentLotId, undefined, "Không được chứa parentLotId");
    assert.equal(lot.actorUserId, undefined, "Không được chứa actorUserId");
    assert.equal(lot.createdBy, undefined, "Không được chứa createdBy");
  });

  await t.test("TC03: Danh sách origins chỉ chứa các trường công khai và tọa độ đại diện cấp xã", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const origins = res.body.origins;
    assert.ok(Array.isArray(origins) && origins.length > 0);

    const allowedOriginKeys = new Set([
      "farmName",
      "area",
      "organizationName",
      "regionName",
      "commune",
      "district",
      "province",
      "coordinates",
      "hasCoordinates",
      "verified",
      "harvestedAt",
    ]);

    for (const origin of origins) {
      for (const key of Object.keys(origin)) {
        assert.ok(
          allowedOriginKeys.has(key),
          `Trường origins.'${key}' không nằm trong danh mục công khai cho phép!`
        );
      }

      assert.equal(origin.originLotId, undefined, "origins không được để lộ originLotId");
      assert.equal(origin.farmId, undefined, "origins không được để lộ farmId");
      assert.equal(origin.rawCoordinates, undefined, "origins không được để lộ rawCoordinates");

      if (origin.coordinates) {
        assert.equal(typeof origin.coordinates.lat, "number");
        assert.equal(typeof origin.coordinates.lng, "number");
        const coordKeys = Object.keys(origin.coordinates);
        assert.deepEqual(coordKeys.sort(), ["lat", "lng"].sort());
      }
    }
  });

  await t.test("TC04: Hành trình journey chỉ chứa thông tin công khai, không lộ ghi chú nội bộ hay danh tính cá nhân", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const journey = res.body.journey;
    assert.ok(Array.isArray(journey) && journey.length > 0);

    const allowedJourneyKeys = new Set([
      "step",
      "type",
      "typeLabel",
      "title",
      "locationName",
      "organizationName",
      "address",
      "coordinates",
      "hasCoordinates",
      "verified",
      "occurredAt",
      "description",
      "isOrigin",
      "isTransfer",
      "isCurrentLocation",
      "hasViolation",
      "warning",
    ]);

    for (const stop of journey) {
      for (const key of Object.keys(stop)) {
        assert.ok(
          allowedJourneyKeys.has(key),
          `Trường journey.'${key}' không nằm trong danh mục công khai cho phép!`
        );
      }

      assert.equal(stop.locationId, undefined, "journey không được để lộ locationId");
      assert.equal(stop.organizationId, undefined, "journey không được để lộ organizationId");
      assert.equal(stop.driverPhone, undefined, "journey không được để lộ số điện thoại tài xế");
      assert.equal(stop.vehiclePlate, undefined, "journey không được để lộ biển số xe nội bộ");
      assert.equal(stop.notes, undefined, "journey không được để lộ ghi chú nội bộ");
    }
  });

  await t.test("TC05: Chuỗi JSON toàn bộ phản hồi không chứa bất kỳ từ khóa nhạy cảm nào", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const jsonString = JSON.stringify(res.body);

    const forbiddenSubstrings = [
      "passwordHash",
      "password_hash",
      "password",
      "actorUserId",
      "actor_user_id",
      "previous_hash",
      "event_hash",
      "contactPerson",
      "contact_person",
      "originLotId",
      "driverPhone",
      "0912345678",
    ];

    for (const term of forbiddenSubstrings) {
      assert.equal(
        jsonString.includes(term),
        false,
        `Chuỗi phản hồi công khai bị rò rỉ từ khóa nhạy cảm: '${term}'`
      );
    }
  });

  await t.test("TC06: sanitizePublicTracePayload lọc triệt để các trường nhạy cảm ngay cả khi đầu vào bị ô nhiễm", () => {
    const dirtyData = {
      lot: {
        code: "LOT-TEST",
        name: "Lô thử nghiệm",
        status: "Đang lưu kho",
        productName: "Chè xanh",
        organizationName: "HTX Chè",
        // Các trường bẩn cần bị loại bỏ:
        organizationId: "org-uuid-12345",
        farmId: "farm-secret-6789",
        passwordHash: "$2b$10$abcdef",
        actorUserId: "user-admin",
        internalAuditNote: "Không công khai",
      },
      origins: [
        {
          farmName: "Vùng trồng thử nghiệm",
          regionName: "Xã Tân Cương",
          coordinates: { lat: 21.55, lng: 105.77, rawGpsAccuracyMeters: 0.5, secretPlotNum: 101 },
          originLotId: "LOT-SECRET-PARENT",
          farmerPhone: "0987654321",
        },
      ],
      journey: [
        {
          step: 1,
          type: "farm",
          title: "Vùng trồng",
          locationId: "loc-9999",
          driverPhone: "0901234567",
          vehiclePlate: "30A-99999",
        },
      ],
      routes: [
        {
          fromStep: 1,
          toStep: 2,
          coordinates: [
            ["105.77", "21.55"],
            ["105.80", "21.03"],
          ],
          secretRouteDistanceKm: 85.5,
        },
      ],
      summary: {
        totalOrigins: 1,
        totalStops: 1,
        verifiedStops: 1,
        serverUptimeSeconds: 999999,
      },
      // Trường cấp cao nhất không hợp lệ:
      databaseConnectionInfo: "postgres://root:secret@db:5432/db",
    };

    const clean = sanitizePublicTracePayload(dirtyData);

    // Kiểm tra lot
    assert.equal(clean.lot.code, "LOT-TEST");
    assert.equal(clean.lot.organizationId, undefined);
    assert.equal(clean.lot.farmId, undefined);
    assert.equal(clean.lot.passwordHash, undefined);
    assert.equal(clean.lot.actorUserId, undefined);
    assert.equal(clean.lot.internalAuditNote, undefined);

    // Kiểm tra origins
    assert.equal(clean.origins[0].farmName, "Vùng trồng thử nghiệm");
    assert.equal(clean.origins[0].originLotId, undefined);
    assert.equal(clean.origins[0].farmerPhone, undefined);
    assert.equal(clean.origins[0].coordinates.rawGpsAccuracyMeters, undefined);
    assert.equal(clean.origins[0].coordinates.secretPlotNum, undefined);
    assert.equal(clean.origins[0].coordinates.lat, 21.55);
    assert.equal(clean.origins[0].coordinates.lng, 105.77);

    // Kiểm tra journey
    assert.equal(clean.journey[0].locationId, undefined);
    assert.equal(clean.journey[0].driverPhone, undefined);
    assert.equal(clean.journey[0].vehiclePlate, undefined);

    // Kiểm tra routes & summary
    assert.equal(clean.routes[0].secretRouteDistanceKm, undefined);
    assert.equal(clean.summary.serverUptimeSeconds, undefined);
    assert.equal(clean.databaseConnectionInfo, undefined);
  });

  await t.test("TC07: Validation định dạng mã lô - chặn ký tự đặc biệt và quá dài (Issue 33)", async () => {
    // Ký tự đặc biệt độc hại
    const resBadChar = await request(app).get("/api/public/lots/<script>alert(1)<%2Fscript>/map");
    assert.equal(resBadChar.status, 400);
    assert.equal(resBadChar.body.error, "INVALID_LOT_CODE");

    // Quá 50 ký tự
    const longCode = "A".repeat(55);
    const resTooLong = await request(app).get(`/api/public/lots/${longCode}/map`);
    assert.equal(resTooLong.status, 400);
    assert.equal(resTooLong.body.error, "INVALID_LOT_CODE");

    // Lô không tồn tại trả về 404
    const resNotFound = await request(app).get("/api/public/lots/LOT-NOT-EXIST-9999/map");
    assert.equal(resNotFound.status, 404);
    assert.equal(resNotFound.body.error, "LOT_NOT_FOUND");
  });

  await t.test("TC08: Che giấu tên thương mại của đối tác trung gian, chỉ hiển thị theo loại vai trò (S-48)", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(res.status, 200);

    const journey = res.body.journey || [];
    // Kiểm tra các chặng trung gian (không phải vùng trồng gốc)
    const intermediateStops = journey.filter((s) => !s.isOrigin);

    const allowedRoleTypes = [
      "Hợp tác xã",
      "Đơn vị vận chuyển",
      "Nhà phân phối",
      "Kho bảo quản",
      "Cơ sở sản xuất",
      "Đối tác chuỗi cung ứng",
    ];

    for (const stop of intermediateStops) {
      // Tên tổ chức trung gian phải thuộc danh mục vai trò chuẩn hóa
      assert.ok(
        allowedRoleTypes.includes(stop.organizationName),
        `Chặng trung gian '${stop.title}' để lộ tên đối tác thương mại riêng tư: '${stop.organizationName}'!`
      );

      // Tuyệt đối không chứa tên công ty thương mại cụ thể
      assert.equal(
        stop.organizationName.includes("Công ty Cổ phần Vận chuyển"),
        false,
        "Không được để lộ tên công ty vận chuyển"
      );
      assert.equal(
        stop.organizationName.includes("Tổng Công ty Phân phối"),
        false,
        "Không được để lộ tên tổng công ty phân phối"
      );
    }
  });

  await t.test("TC09: Tuyệt đối không xuất khối lượng hàng hóa và giá bán/nhập trong API công khai (S-48)", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const jsonStr = JSON.stringify(res.body);
    const forbiddenCommercialTerms = [
      "initialQuantity",
      "remainingQuantity",
      "quantity",
      "price",
      "importPrice",
      "exportPrice",
      "unitPrice",
      "totalAmount",
      "farmArea",
    ];

    for (const term of forbiddenCommercialTerms) {
      assert.equal(
        res.body.lot[term],
        undefined,
        `Trường thương mại '${term}' không được phép xuất hiện trong lot công khai!`
      );
    }

    // Kiểm tra cả trên endpoint /map
    const resMap = await request(app).get("/api/public/lots/LOT-001/map");
    for (const term of forbiddenCommercialTerms) {
      assert.equal(
        resMap.body.lot[term],
        undefined,
        `Trường thương mại '${term}' không được phép xuất hiện trong lot trên /map!`
      );
    }
    for (const orig of (resMap.body.origins || [])) {
      assert.equal(orig.area, undefined, "origins không được để lộ diện tích / diện tích canh tác");
      assert.equal(orig.initialQuantity, undefined, "origins không được để lộ khối lượng");
    }
  });
});
