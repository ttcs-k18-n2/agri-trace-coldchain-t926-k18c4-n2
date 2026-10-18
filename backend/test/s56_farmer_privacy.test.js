"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  inMemoryLots,
  inMemoryFarms,
  inMemoryBatchEvents,
  inMemoryAuditLogs,
  seedDemoUser,
  GENESIS_HASH,
  calculateEventHash,
  verifyBatchEventChain,
} = require("../src/server");

// Helper to authenticate agents
async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-56 (Jira N2-124): Cơ chế xóa định danh nông hộ tuân thủ Nghị định 13/2023/NĐ-CP & Bảo toàn chuỗi Hash", async (t) => {
  await seedDemoUser();

  // Chuẩn bị dữ liệu thử nghiệm trong bộ nhớ
  const testFarmId = "FARM-PRIVACY-001";
  const testLotId = "LOT-PRIVACY-001";

  const originalFarm = {
    id: testFarmId,
    name: "Vườn bưởi Diễn của bác Nguyễn Văn A",
    area: 1.8,
    coordinates: "21.0500, 105.7500",
    organizationId: "org-001",
    farmerName: "Nguyễn Văn A",
    farmerPhone: "0912345678",
    farmerAddress: "Thôn 3, Xã Phú Diễn, Bắc Từ Liêm, Hà Nội",
    isAnonymized: false,
  };
  inMemoryFarms.push(originalFarm);

  // Tạo lô hàng gắn với thửa đất này
  inMemoryLots.push({
    id: testLotId,
    name: "Lô bưởi Diễn thu hoạch đợt 1",
    status: "Đã thu hoạch",
    organizationId: "org-001",
    farmId: testFarmId,
    productId: "PROD-POMELO",
    initialQuantity: 1000,
    remainingQuantity: 1000,
  });

  // Tạo chuỗi sự kiện mật mã học (S-12) chuẩn K-01 cho lô này
  const ev1Data = {
    batchId: testLotId,
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    actorUserId: "usr-prod-001",
    occurredAt: "2026-10-15T08:00:00.000Z",
    payload: {
      farmId: testFarmId,
      productId: "PROD-POMELO",
      quantity: 1000,
    },
  };
  const ev1Hash = calculateEventHash(GENESIS_HASH, ev1Data);
  const ev1 = {
    id: "EV-PRIV-1",
    ...ev1Data,
    previousHash: GENESIS_HASH,
    eventHash: ev1Hash,
  };

  const ev2Data = {
    batchId: testLotId,
    sequenceNo: 2,
    eventType: "PACKAGING_COMPLETED",
    organizationId: "org-001",
    actorUserId: "usr-prod-001",
    occurredAt: "2026-10-15T10:00:00.000Z",
    payload: {
      packageCount: 50,
      packagingType: "CARTON_BOX",
    },
  };
  const ev2Hash = calculateEventHash(ev1Hash, ev2Data);
  const ev2 = {
    id: "EV-PRIV-2",
    ...ev2Data,
    previousHash: ev1Hash,
    eventHash: ev2Hash,
  };

  inMemoryBatchEvents.push(ev1, ev2);

  // 1. Kiểm tra tính toàn vẹn ban đầu của chuỗi hash
  await t.test("1. Chuỗi hash mật mã học của lô hàng ban đầu phải hợp lệ 100%", () => {
    const checkBefore = verifyBatchEventChain([ev1, ev2]);
    assert.strictEqual(checkBefore.valid, true, "Chuỗi hash ban đầu phải hợp lệ");
  });

  // 2. Kiểm tra RBAC endpoint POST /api/privacy/farmers/:id/anonymize
  await t.test("2. Kiểm tra RBAC: Yêu cầu ẩn danh phải được kiểm soát quyền chặt chẽ", async () => {
    // Chưa xác thực -> 401
    const unauthRes = await request(app)
      .post(`/api/privacy/farmers/${testFarmId}/anonymize`)
      .send({ requesterName: "Nguyễn Văn A" });
    assert.strictEqual(unauthRes.status, 401);

    // Quyền producer thông thường -> 403
    const producerAgent = await loginAs("user@example.com");
    const forbiddenRes = await producerAgent
      .post(`/api/privacy/farmers/${testFarmId}/anonymize`)
      .send({ requesterName: "Nguyễn Văn A" });
    assert.strictEqual(forbiddenRes.status, 403);
  });

  // 3. Thực hiện xóa dữ liệu định danh nông hộ bởi Admin
  await t.test("3. Admin thực hiện xóa dữ liệu định danh nông hộ (Nghị định 13/2023/NĐ-CP)", async () => {
    const adminAgent = await loginAs("admin@example.com");
    const anonRes = await adminAgent
      .post(`/api/privacy/farmers/${testFarmId}/anonymize`)
      .send({
        requesterName: "Nguyễn Văn A",
        requesterPhone: "0912345678",
        legalBasis: "Khoản 1 Điều 16 Nghị định 13/2023/NĐ-CP",
        notes: "Nông hộ chấm dứt hợp đồng canh tác và yêu cầu xóa thông tin cá nhân",
      });

    assert.strictEqual(anonRes.status, 200);
    assert.strictEqual(anonRes.body.success, true);
    assert.strictEqual(anonRes.body.farmId, testFarmId);
    assert.ok(anonRes.body.requestId.startsWith("REQ-PRIVACY-"));

    // Kiểm tra PII đã được xóa sạch
    const sanitized = anonRes.body.sanitizedFarm;
    assert.strictEqual(sanitized.isAnonymized, true);
    assert.strictEqual(sanitized.farmerPhone, null);
    assert.strictEqual(sanitized.farmerAddress, null);
    assert.match(sanitized.farmerName, /ẨN DANH/i);
  });

  // 4. Bảo toàn chuỗi Hash: Sau khi xóa PII, chuỗi hash mật mã học vẫn nguyên vẹn 100%
  await t.test("4. BẢO TOÀN CHUỖI HASH: Chuỗi sự kiện lô hàng vẫn đạt tính toàn vẹn 100%", () => {
    const lotEvents = inMemoryBatchEvents
      .filter((e) => (e.batchId || e.batch_id) === testLotId)
      .sort((a, b) => Number(a.sequenceNo || a.sequence_no) - Number(b.sequenceNo || b.sequence_no));
    const checkAfter = verifyBatchEventChain(lotEvents);

    assert.strictEqual(checkAfter.valid, true, "Chuỗi hash S-12 không bị phá vỡ sau khi xóa PII");
    assert.strictEqual(lotEvents[0].eventHash, ev1Hash, "Hash sự kiện thu hoạch giữ nguyên");
    assert.strictEqual(lotEvents[1].eventHash, ev2Hash, "Hash sự kiện đóng gói giữ nguyên");
  });

  // 5. Kiểm tra API GET /api/farms/:id không để lộ PII
  await t.test("5. API GET /api/farms/:id trả về dữ liệu đã ẩn danh, không lộ họ tên, SĐT, địa chỉ", async () => {
    const adminAgent = await loginAs("admin@example.com");
    const getRes = await adminAgent.get(`/api/farms/${testFarmId}`);

    assert.strictEqual(getRes.status, 200);
    const farm = getRes.body.farm;
    assert.strictEqual(farm.isAnonymized, true);
    assert.strictEqual(farm.farmerPhone, null);
    assert.strictEqual(farm.farmerAddress, null);
    assert.match(farm.farmerName, /ẨN DANH/i);
    assert.doesNotMatch(farm.name, /Nguyễn Văn A/i);
  });

  // 6. Kiểm tra API GET /api/privacy/anonymization-requests lưu vết đầy đủ
  await t.test("6. API GET /api/privacy/anonymization-requests cho phép thanh tra/admin truy vấn hồ sơ xóa", async () => {
    const inspectorAgent = await loginAs("inspector@example.com");
    const reqsRes = await inspectorAgent.get("/api/privacy/anonymization-requests");

    assert.strictEqual(reqsRes.status, 200);
    assert.ok(Array.isArray(reqsRes.body.requests));
    const found = reqsRes.body.requests.find((r) => (r.farmId || r.farm_id) === testFarmId);
    assert.ok(found, "Phải tìm thấy hồ sơ yêu cầu xóa dữ liệu của testFarmId");
    assert.strictEqual(found.status, "COMPLETED");
    assert.match(found.legalBasis || found.legal_basis, /13\/2023/);
  });

  // 7. Nhật ký kiểm toán S-31 ghi nhận hành vi FARMER_PII_ANONYMIZED
  await t.test("7. Nhật ký kiểm toán S-31 ghi nhận hành vi FARMER_PII_ANONYMIZED", () => {
    const auditRecord = inMemoryAuditLogs.find(
      (log) => log.action === "FARMER_PII_ANONYMIZED" && log.resourceId === testFarmId
    );
    assert.ok(auditRecord, "Phải tồn tại audit log FARMER_PII_ANONYMIZED");
    assert.strictEqual(auditRecord.resourceType, "farm");
  });

  // 8. Thao tác trên nông hộ không tồn tại trả về 404 an toàn
  await t.test("8. Thao tác trên nông hộ không tồn tại trả về 404 an toàn", async () => {
    const adminAgent = await loginAs("admin@example.com");
    const notFoundRes = await adminAgent
      .post("/api/privacy/farmers/NON-EXISTENT-FARM/anonymize")
      .send({ requesterName: "Ai đó" });
    assert.strictEqual(notFoundRes.status, 404);
  });
});
