/**
 * Test Suite: Story S-60 (N2-131, N2-290, N2-257, N2-258)
 * Bản đồ vị trí vùng trồng và điểm phân phối trên trang truy xuất công khai
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchEvents,
  inMemoryAuditLogs,
  seedS22Data,
  setDatabasePool,
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

  await t.test("8b. Xử lý lỗi 400 khi mã lô vượt quá 50 ký tự hoặc chứa ký tự đặc biệt", async () => {
    // Mã dài quá 50 ký tự
    const longCode = "A".repeat(55);
    const res1 = await request(app).get(`/api/public/lots/${longCode}/map`);
    assert.equal(res1.status, 400);
    assert.equal(res1.body.error, "INVALID_LOT_CODE");

    // Mã chứa ký tự đặc biệt độc hại
    const res2 = await request(app).get("/api/public/lots/LOT%3Cscript%3E/map");
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, "INVALID_LOT_CODE");
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

    // 4. Kiểm tra nông trại ở tỉnh khác trồng cùng loại nông sản KHÔNG bị gán nhầm vào Thái Nguyên (Issue 9)
    const farmLamDong = { name: "Hợp tác xã Cà chua Đà Lạt", address: "Đơn Dương, Lâm Đồng" };
    const areaLamDong = await resolveRepresentativeArea(null, farmLamDong);
    assert.notEqual(areaLamDong.regionName, "Vùng trồng nông sản an toàn Hùng Sơn", "Không được đoán vị trí dựa trên từ khóa cà chua");
    assert.equal(areaLamDong.hasCoordinates, false);
  });

  await t.test("11. Hàm parseCoordinates kiểm tra phạm vi vĩ độ/kinh độ và chặn Infinity/NaN", async () => {
    const { parseCoordinates } = require("../src/public_trace_map");
    assert.equal(parseCoordinates("Infinity, 105.0"), null, "Chặn Infinity");
    assert.equal(parseCoordinates("21.0, NaN"), null, "Chặn NaN");
    assert.equal(parseCoordinates("95.0, 105.0"), null, "Chặn vĩ độ > 90");
    assert.equal(parseCoordinates("-95.0, 105.0"), null, "Chặn vĩ độ < -90");
    assert.equal(parseCoordinates("21.0, 185.0"), null, "Chặn kinh độ > 180");
    assert.equal(parseCoordinates("21.0, -185.0"), null, "Chặn kinh độ < -180");

    const valid = parseCoordinates("21.5580, 105.6720");
    assert.ok(valid);
    assert.equal(valid.lat, 21.558);
    assert.equal(valid.lng, 105.672);
  });

  await t.test("12. PATCH /api/lots/:id/coordinates - Phân quyền và kiểm tra sở hữu lô hàng", async () => {
    const passwordHash = await hashPassword("Password123!");
    users.set("producer_org1@test.vn", {
      id: "usr-prod-org1",
      email: "producer_org1@test.vn",
      passwordHash,
      roleId: "producer",
      organizationId: "org-001",
      status: "active",
    });
    users.set("coop_org2@test.vn", {
      id: "usr-coop-org2",
      email: "coop_org2@test.vn",
      passwordHash,
      roleId: "cooperative",
      organizationId: "org-002",
      status: "active",
    });
    users.set("inspector@test.vn", {
      id: "usr-inspector",
      email: "inspector@test.vn",
      passwordHash,
      roleId: "inspector",
      organizationId: "org-inspector",
      status: "active",
    });
    users.set("auditor@test.vn", {
      id: "usr-auditor",
      email: "auditor@test.vn",
      passwordHash,
      roleId: "auditor",
      organizationId: "org-inspector",
      status: "active",
    });

    // 1. Unauthenticated request -> 401
    const unauthRes = await request(app)
      .patch("/api/lots/LOT-001/coordinates")
      .send({ coordinates: "21.5750, 105.6905" });
    assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải bị chặn 401");

    // 2. Inspector (chỉ đọc) -> 403
    const inspectorAgent = request.agent(app);
    await inspectorAgent.post("/api/login").send({ email: "inspector@test.vn", password: "Password123!" });
    const inspectorRes = await inspectorAgent
      .patch("/api/lots/LOT-001/coordinates")
      .send({ coordinates: "21.5750, 105.6905" });
    assert.equal(inspectorRes.status, 403, "Inspector không được sửa tọa độ");

    // 3. Auditor (chỉ đọc) -> 403
    const auditorAgent = request.agent(app);
    await auditorAgent.post("/api/login").send({ email: "auditor@test.vn", password: "Password123!" });
    const auditorRes = await auditorAgent
      .patch("/api/lots/LOT-001/coordinates")
      .send({ coordinates: "21.5750, 105.6905" });
    assert.equal(auditorRes.status, 403, "Auditor không được sửa tọa độ");

    // 4. Tổ chức khác (org-002) cố sửa lô của org-001 -> 403
    const coopAgent = request.agent(app);
    await coopAgent.post("/api/login").send({ email: "coop_org2@test.vn", password: "Password123!" });
    const crossRes = await coopAgent
      .patch("/api/lots/LOT-001/coordinates")
      .send({ coordinates: "21.5750, 105.6905" });
    assert.equal(crossRes.status, 403, "Tổ chức không sở hữu lô phải bị 403");

    // 5. Lô không tồn tại -> 404
    const prodAgent = request.agent(app);
    await prodAgent.post("/api/login").send({ email: "producer_org1@test.vn", password: "Password123!" });
    const notFoundRes = await prodAgent
      .patch("/api/lots/LOT-NON-EXISTENT/coordinates")
      .send({ coordinates: "21.5750, 105.6905" });
    assert.equal(notFoundRes.status, 404, "Lô không tồn tại phải trả 404");

    // 6. Định dạng tọa độ sai -> 400
    const invalidRes = await prodAgent
      .patch("/api/lots/LOT-001/coordinates")
      .send({ coordinates: "invalid-coords" });
    assert.equal(invalidRes.status, 400, "Tọa độ sai định dạng phải trả 400");
  });

  await t.test("13. PATCH /api/lots/:id/coordinates - Cập nhật tọa độ thành công, audit log và hiển thị trên bản đồ", async () => {
    const prodAgent = request.agent(app);
    await prodAgent.post("/api/login").send({ email: "producer_org1@test.vn", password: "Password123!" });

    const auditCountBefore = inMemoryAuditLogs.length;

    const res = await prodAgent
      .patch("/api/lots/LOT-001/coordinates")
      .send({
        coordinates: "21.5750, 105.6905",
        name: "Vùng trồng thử nghiệm Nông trại 1",
        address: "Xã Hùng Sơn, Đại Từ, Thái Nguyên",
        type: "farm",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.coordinates.lat, 21.575);
    assert.equal(res.body.coordinates.lng, 105.6905);

    // Kiểm tra audit log (lưu ý audit_logger dùng unshift nên log mới nhất ở index 0)
    assert.ok(inMemoryAuditLogs.length > auditCountBefore, "Audit log phải được ghi nhận");
    const lastLog = inMemoryAuditLogs[0];
    assert.equal(lastLog.action, "UPDATE_LOT_COORDINATES");
    assert.equal(lastLog.actorUserId, "usr-prod-org1");
    assert.equal(lastLog.resourceId, "LOT-001");
    assert.equal(lastLog.details.name, "Vùng trồng thử nghiệm Nông trại 1");

    // Kiểm tra API công khai đọc được tọa độ mới
    const mapRes = await request(app).get("/api/public/lots/LOT-001/map");
    assert.equal(mapRes.status, 200);
    const origin = mapRes.body.origins[0];
    assert.equal(origin.hasCoordinates, true);
    assert.equal(origin.coordinates.lat, 21.575);
    assert.equal(origin.coordinates.lng, 105.6905);
  });

  await t.test("14. PATCH /api/lots/:id/coordinates - Xử lý lỗi DB và bảo vệ toàn vẹn RAM", async () => {
    const prodAgent = request.agent(app);
    await prodAgent.post("/api/login").send({ email: "producer_org1@test.vn", password: "Password123!" });

    const lotBefore = inMemoryLots.find((l) => l.id === "LOT-002");
    const originalCustom = lotBefore ? lotBefore.customCoordinates : undefined;

    // Giả lập pool ném lỗi (ví dụ thiếu cột hoặc lỗi kết nối DB)
    const mockFaultyPool = {
      async query(sql) {
        if (sql.includes("SELECT * FROM lots")) {
          return { rows: [{ id: "LOT-002", organization_id: "org-001" }] };
        }
        if (sql.includes("UPDATE lots SET custom_coordinates")) {
          throw new Error("column \"custom_coordinates\" of relation \"lots\" does not exist");
        }
        return { rows: [] };
      },
    };

    setDatabasePool(mockFaultyPool);

    try {
      const res = await prodAgent
        .patch("/api/lots/LOT-002/coordinates")
        .send({
          coordinates: "21.6000, 105.7000",
          name: "Vùng chè lỗi DB",
        });

      assert.equal(res.status, 500, "Lỗi DB phải trả mã 500 thay vì 200");
      assert.equal(res.body.error, "DATABASE_ERROR");
      assert.match(res.body.message, /custom_coordinates/);

      // RAM không được cập nhật trước khi DB thành công
      const lotAfter = inMemoryLots.find((l) => l.id === "LOT-002");
      assert.deepEqual(lotAfter.customCoordinates, originalCustom, "RAM không được cập nhật nếu DB bị lỗi");
    } finally {
      setDatabasePool(null);
    }
  });

  await t.test("15. getPublicLotMapData đọc l.custom_coordinates từ kết quả SELECT PostgreSQL", async () => {
    let queriedCustomCoordinates = false;
    const lotRow = {
      id: "LOT-DB-TEST",
      name: "Lô kiểm thử đọc DB",
      status: "Đã thu hoạch",
      organization_id: "org-001",
      organization_name: "Nông trại Thái Nguyên",
      farm_id: null,
      farm_name: "Thửa trồng chưa có tọa độ đại diện",
      farm_coordinates: null,
      farm_area: 2.5,
      product_id: "PROD-TEA",
      product_name: "Chè búp",
      product_unit: "kg",
      initial_quantity: 100,
      remaining_quantity: 100,
      harvested_at: "2026-10-10",
      parent_lot_id: null,
      location_id: null,
      created_at: new Date().toISOString(),
      custom_coordinates: {
        lat: 21.5432,
        lng: 105.7654,
        name: "Điểm ghim DB chính xác",
        type: "farm",
      },
    };

    const mockDbPool = {
      async query(sql) {
        if (sql.includes("UPPER(l.id) = UPPER($1)")) {
          queriedCustomCoordinates = sql.includes("l.custom_coordinates");
          return { rows: [lotRow] };
        }
        if (sql.includes("WHERE l.id = ANY($1)")) {
          return { rows: [lotRow] };
        }
        return { rows: [] };
      },
    };

    const mapData = await getPublicLotMapData({
      pool: mockDbPool,
      lotCode: "LOT-DB-TEST",
      inMemoryLots: [],
      inMemoryBatchRelations: [],
      inMemoryBatchEvents: [],
      inMemoryOrgs: [],
      inMemoryProducts: [],
      inMemoryFarms: [],
      inMemoryLocations: [],
    });

    assert.ok(queriedCustomCoordinates, "Câu SQL trong public_trace_map phải SELECT l.custom_coordinates");
    assert.ok(mapData);
    assert.equal(mapData.lot.code, "LOT-DB-TEST");
    assert.ok(mapData.origins.length > 0);
    assert.equal(mapData.origins[0].hasCoordinates, true);
    assert.equal(mapData.origins[0].coordinates.lat, 21.5432);
    assert.equal(mapData.origins[0].coordinates.lng, 105.7654);
  });
});
