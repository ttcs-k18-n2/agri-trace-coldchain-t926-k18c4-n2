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
  users,
  hashPassword,
} = require("../src/server");
const { anonymizeFarmerData } = require("../src/farmer_privacy_service");

// Helper to authenticate agents
async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-56 (Jira N2-124 / N2-286 / N2-243 / N2-300 / N2-244 / N2-301): Cơ chế xóa định danh nông hộ tuân thủ Nghị định 13/2023/NĐ-CP & Bảo toàn chuỗi Hash", async (t) => {
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

  // Tạo chuỗi sự kiện mật mã học (S-12) chuẩn K-01 cho lô này (Tách PII khỏi payload)
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

  // 9. org_admin chỉ được thao tác với nông hộ thuộc tổ chức của mình
  await t.test("9. org_admin thuộc tổ chức org-001 được phép ẩn danh nông hộ của org-001", async () => {
    const testFarmOrg1 = {
      id: "FARM-ORG1-002",
      name: "Vườn thanh long Hoàng Trang",
      area: 2.5,
      coordinates: "10.7500, 106.6500",
      organizationId: "org-001",
      farmerName: "Trần Thị B",
      farmerPhone: "0987654321",
      farmerAddress: "Ấp 2, Xã Chợ Gạo, Tiền Giang",
      isAnonymized: false,
    };
    inMemoryFarms.push(testFarmOrg1);

    const orgAdminAgent = await loginAs("orgadmin@example.com"); // org-001
    const res = await orgAdminAgent
      .post(`/api/privacy/farmers/${testFarmOrg1.id}/anonymize`)
      .send({
        requesterName: "Trần Thị B",
        legalBasis: "Nghị định 13/2023/NĐ-CP",
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.farmId, testFarmOrg1.id);
    assert.strictEqual(res.body.sanitizedFarm.isAnonymized, true);
    assert.strictEqual(res.body.sanitizedFarm.farmerPhone, null);
  });

  // 10. Chống IDOR: org_admin của tổ chức B không được thao tác trên nông hộ của tổ chức A
  await t.test("10. Chống IDOR: org_admin thuộc org-002 bị từ chối 403 khi cố ẩn danh nông hộ của org-001", async () => {
    // Tạo user orgadmin cho org-002
    const passHash = await hashPassword("Password@123");
    users.set("orgadmin-org2@example.com", {
      id: "usr-orgadmin-002",
      email: "orgadmin-org2@example.com",
      passwordHash: passHash,
      failedCount: 0,
      lockedUntil: null,
      organizationId: "org-002",
      roleId: "org_admin",
    });

    const testFarmOrg1New = {
      id: "FARM-ORG1-SECURE",
      name: "Vườn chanh không hạt org-001",
      area: 1.2,
      organizationId: "org-001",
      farmerName: "Lê Văn C",
      farmerPhone: "0909123456",
      farmerAddress: "Long An",
      isAnonymized: false,
    };
    inMemoryFarms.push(testFarmOrg1New);

    const org2AdminAgent = await loginAs("orgadmin-org2@example.com");

    // org_admin org-002 cố tình gửi kèm body organizationId: 'org-001' để giả mạo (spoofing)
    const idorRes = await org2AdminAgent
      .post(`/api/privacy/farmers/${testFarmOrg1New.id}/anonymize`)
      .send({
        organizationId: "org-001", // Client spoofing
        requesterName: "Lê Văn C",
      });

    assert.strictEqual(idorRes.status, 403, "Phải trả về 403 FORBIDDEN khi thao tác chéo tổ chức");
    assert.match(idorRes.body.message, /quyền/i);

    // Xác nhận dữ liệu nông hộ ở org-001 KHÔNG bị thay đổi
    const checkFarm = inMemoryFarms.find((f) => f.id === testFarmOrg1New.id);
    assert.strictEqual(checkFarm.isAnonymized, false, "Nông hộ chưa bị ẩn danh");
    assert.strictEqual(checkFarm.farmerName, "Lê Văn C", "Tên nông hộ vẫn giữ nguyên");
  });

  // 11. Kiểm tra API GET /api/privacy/anonymization-requests lọc đúng theo tổ chức của org_admin
  await t.test("11. API GET /api/privacy/anonymization-requests cách ly danh sách theo tổ chức, không rò rỉ dữ liệu liên tổ chức", async () => {
    // Thêm 1 nông hộ thuộc org-002 và ẩn danh bởi org_admin org-002
    const farmOrg2 = {
      id: "FARM-ORG2-PRIVATE",
      name: "Vườn bơ Booth org-002",
      organizationId: "org-002",
      farmerName: "Phạm Văn D",
      farmerPhone: "0933445566",
      isAnonymized: false,
    };
    inMemoryFarms.push(farmOrg2);

    const org2AdminAgent = await loginAs("orgadmin-org2@example.com");
    const anonResOrg2 = await org2AdminAgent
      .post(`/api/privacy/farmers/${farmOrg2.id}/anonymize`)
      .send({ requesterName: "Phạm Văn D" });
    assert.strictEqual(anonResOrg2.status, 200);

    // org_admin org-001 truy vấn danh sách yêu cầu
    const org1AdminAgent = await loginAs("orgadmin@example.com");
    const listOrg1 = await org1AdminAgent.get("/api/privacy/anonymization-requests");
    assert.strictEqual(listOrg1.status, 200);

    // Đảm bảo org-001 KHÔNG nhìn thấy yêu cầu của org-002
    const hasOrg2Request = listOrg1.body.requests.some(
      (r) => (r.farmId || r.farm_id) === farmOrg2.id
    );
    assert.strictEqual(hasOrg2Request, false, "org_admin org-001 không được nhìn thấy yêu cầu của org-002");

    // org_admin org-002 truy vấn danh sách yêu cầu
    const listOrg2 = await org2AdminAgent.get("/api/privacy/anonymization-requests");
    assert.strictEqual(listOrg2.status, 200);
    const hasOnlyOrg2 = listOrg2.body.requests.every(
      (r) => (r.farmId || r.farm_id) === farmOrg2.id
    );
    assert.strictEqual(hasOnlyOrg2, true, "org_admin org-002 chỉ thấy các yêu cầu thuộc org-002");

    // admin toàn hệ thống truy vấn danh sách -> Thấy cả hai
    const adminAgent = await loginAs("admin@example.com");
    const listAdmin = await adminAgent.get("/api/privacy/anonymization-requests");
    assert.strictEqual(listAdmin.status, 200);
    assert.ok(listAdmin.body.requests.length >= 2, "Admin toàn hệ thống thấy toàn bộ yêu cầu");
  });

  // 12. Kiểm tra tính nguyên tử (Transaction Atomicity & Rollback)
  await t.test("12. Quá trình ẩn danh phải thực thi trong Transaction và Rollback toàn bộ nếu có lỗi xảy ra", async () => {
    let txStatus = null;
    const executedQueries = [];

    const mockPgClient = {
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (sql === "BEGIN;") txStatus = "IN_TX";
        if (sql === "COMMIT;") txStatus = "COMMITTED";
        if (sql === "ROLLBACK;") txStatus = "ROLLED_BACK";

        if (sql.includes("SELECT") && sql.includes("farms")) {
          return {
            rows: [
              {
                id: "FARM-TX-001",
                name: "Vườn sầu riêng Ri6",
                organization_id: "org-001",
                farmer_name: "Hoàng Văn E",
                is_anonymized: false,
              },
            ],
          };
        }

        if (sql.includes("UPDATE farms")) {
          return { rowCount: 1 };
        }

        // Mô phỏng lỗi khi ghi nhận yêu cầu vào farmer_anonymization_requests
        if (sql.includes("INSERT INTO farmer_anonymization_requests")) {
          throw new Error("Lỗi kết nối cơ sở dữ liệu khi ghi bản ghi yêu cầu ẩn danh");
        }

        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockPgClient,
    };

    await assert.rejects(
      async () => {
        await anonymizeFarmerData({
          pool: mockPool,
          farmId: "FARM-TX-001",
          organizationId: "org-001",
          isSystemAdmin: false,
        });
      },
      /Lỗi kết nối cơ sở dữ liệu/
    );

    assert.strictEqual(txStatus, "ROLLED_BACK", "Transaction phải được ROLLBACK khi có lỗi");
    assert.ok(executedQueries.some((q) => q.sql === "BEGIN;"), "Phải có BEGIN");
    assert.ok(executedQueries.some((q) => q.sql === "ROLLBACK;"), "Phải có ROLLBACK");
  });

  // 13. S-56 Hardening: Che giấu triệt để requester_name, requester_phone và chỉ lưu minimal metadata trong audit logs
  await t.test(
    "13. S-56 Hardening: Che giấu triệt để requester_name, requester_phone và chỉ lưu minimal metadata trong audit logs",
    async () => {
      const farmHardened = {
        id: "FARM-HARDEN-001",
        name: "Vườn măng cụt của anh Vũ",
        area: 3.0,
        organizationId: "org-001",
        farmerName: "Vũ Văn V",
        farmerPhone: "0901112233",
        farmerAddress: "Bến Tre",
        phone: "0901112233",
        address: "Bến Tre",
        isAnonymized: false,
      };
      inMemoryFarms.push(farmHardened);

      const adminAgent = await loginAs("admin@example.com");
      const res = await adminAgent
        .post(`/api/privacy/farmers/${farmHardened.id}/anonymize`)
        .send({
          requesterName: "Vũ Văn V (chính chủ)",
          requesterPhone: "0901112233",
          legalBasis: "Điều 16 Nghị định 13/2023/NĐ-CP",
          notes: "Nông hộ yêu cầu xóa sạch PII trên hệ thống",
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // 1. Kiểm tra sanitizedFarm không còn phone, address, farmerPhone, farmerAddress
      const sFarm = res.body.sanitizedFarm;
      assert.strictEqual(sFarm.farmerPhone, null);
      assert.strictEqual(sFarm.farmerAddress, null);
      assert.strictEqual(sFarm.phone, null);
      assert.strictEqual(sFarm.address, null);
      assert.match(sFarm.farmerName, /ẨN DANH/);

      // 2. Kiểm tra hồ sơ yêu cầu anonymization requests không lưu PII thô
      const reqListRes = await adminAgent.get("/api/privacy/anonymization-requests");
      assert.strictEqual(reqListRes.status, 200);
      const reqRecord = reqListRes.body.requests.find((r) => (r.farmId || r.farm_id) === farmHardened.id);
      assert.ok(reqRecord);
      assert.strictEqual(reqRecord.requesterName, "[CHỦ THỂ DỮ LIỆU - NÔNG HỘ]");
      assert.strictEqual(reqRecord.requesterPhone, null);
      assert.doesNotMatch(JSON.stringify(reqRecord), /0901112233/);
      assert.doesNotMatch(JSON.stringify(reqRecord), /Vũ Văn V \(chính chủ\)/);

      // 3. Kiểm tra audit log chỉ lưu minimal metadata
      const auditRec = inMemoryAuditLogs.find(
        (log) => log.action === "FARMER_PII_ANONYMIZED" && log.resourceId === farmHardened.id
      );
      assert.ok(auditRec);
      assert.strictEqual(auditRec.details.requestId, res.body.requestId);
      assert.strictEqual(auditRec.details.legalBasis, "Điều 16 Nghị định 13/2023/NĐ-CP");
      assert.ok(auditRec.details.timestamp);
      assert.strictEqual(auditRec.details.notes, undefined, "Không được lưu notes trong audit log");
      assert.doesNotMatch(JSON.stringify(auditRec.details), /0901112233/);
      assert.doesNotMatch(JSON.stringify(auditRec.details), /Vũ Văn V/);
    }
  );
});
