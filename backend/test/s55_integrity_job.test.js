"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const {
  app,
  seedDemoUser,
  inMemoryLots,
  inMemoryBatchEvents,
  inMemoryAuditLogs,
} = require("../src/server");
const {
  runIntegrityAuditJob,
  getLatestIntegrityAudit,
  inMemoryIntegrityJobs,
  inMemoryIntegrityLogs,
} = require("../src/integrity_periodic_job");
const { calculateEventHash, GENESIS_HASH } = require("../src/integrity");
const { getAuditLogs } = require("../src/audit_logger");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

function setupS55Dataset() {
  inMemoryLots.length = 0;
  inMemoryBatchEvents.length = 0;
  inMemoryAuditLogs.length = 0;
  inMemoryIntegrityJobs.length = 0;
  inMemoryIntegrityLogs.length = 0;

  // Lô 1: Khỏe mạnh, chuỗi hash toàn vẹn (LOT-S55-HEALTHY)
  inMemoryLots.push({
    id: "LOT-S55-HEALTHY",
    code: "LOT-S55-HEALTHY",
    name: "Dâu tây giống Nhật",
    organizationId: "org-001",
    status: "Đang lưu thông",
    createdAt: "2026-10-18T00:00:00.000Z",
  });

  const hEv1Data = {
    batchId: "LOT-S55-HEALTHY",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-18T01:00:00.000Z",
    payload: { farmId: "FARM-01", quantity: 300 },
  };
  const hEv1Hash = calculateEventHash(GENESIS_HASH, hEv1Data);

  const hEv2Data = {
    batchId: "LOT-S55-HEALTHY",
    sequenceNo: 2,
    eventType: "TEMPERATURE_RECORDED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-18T02:00:00.000Z",
    payload: { temperatureC: 3.8 },
  };
  const hEv2Hash = calculateEventHash(hEv1Hash, hEv2Data);

  inMemoryBatchEvents.push(
    { id: "hev-1", ...hEv1Data, previousHash: GENESIS_HASH, eventHash: hEv1Hash },
    { id: "hev-2", ...hEv2Data, previousHash: hEv1Hash, eventHash: hEv2Hash }
  );

  // Lô 2: Bị can thiệp sửa lén (LOT-S55-COMPROMISED)
  inMemoryLots.push({
    id: "LOT-S55-COMPROMISED",
    code: "LOT-S55-COMPROMISED",
    name: "Sầu riêng Ri6",
    organizationId: "org-002",
    status: "Đang lưu thông",
    createdAt: "2026-10-18T00:00:00.000Z",
  });

  const cEv1Data = {
    batchId: "LOT-S55-COMPROMISED",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    organizationId: "org-002",
    actorUserId: "usr-002",
    occurredAt: "2026-10-18T01:00:00.000Z",
    payload: { farmId: "FARM-02", quantity: 500 },
  };
  const cEv1Hash = calculateEventHash(GENESIS_HASH, cEv1Data);

  // Sự kiện 2 bị kẻ xấu sửa payload mà không thể tính lại hash hợp lệ
  inMemoryBatchEvents.push(
    { id: "cev-1", ...cEv1Data, previousHash: GENESIS_HASH, eventHash: cEv1Hash },
    {
      id: "cev-2-tampered",
      batchId: "LOT-S55-COMPROMISED",
      sequenceNo: 2,
      eventType: "TEMPERATURE_RECORDED",
      organizationId: "org-002",
      actorUserId: "usr-attacker",
      occurredAt: "2026-10-18T02:00:00.000Z",
      payload: { temperatureC: 2.0 }, // Đã bị sửa
      previousHash: cEv1Hash,
      eventHash: "bad_invalid_hash_value_that_does_not_match_payload_at_all!",
    }
  );
}

test("Story S-55: Job kiểm tra toàn vẹn định kỳ mọi lô và cảnh báo khi phát hiện đứt mạch (Jira N2-123)", async (t) => {
  await seedDemoUser();

  await t.test(
    "N2-241: Job quét hàng loạt theo từng mẻ nhỏ (batching) và ghi nhận kết quả",
    async () => {
      setupS55Dataset();

      // Chỉ quét lô khỏe mạnh trước
      inMemoryLots.length = 1;

      const jobResult = await runIntegrityAuditJob({
        batchSize: 10,
        inMemoryContext: {
          inMemoryLots,
          inMemoryBatchEvents,
          inMemoryAuditLogs,
        },
      });

      assert.equal(jobResult.status, "PASSED");
      assert.equal(jobResult.totalLotsScanned, 1);
      assert.equal(jobResult.compromisedLotsCount, 0);
      assert.equal(jobResult.logs.length, 1);
      assert.equal(jobResult.logs[0].is_valid, true);

      // Kiểm tra API lấy kết quả lần chạy gần nhất
      const latest = await getLatestIntegrityAudit({
        inMemoryContext: { inMemoryLots, inMemoryBatchEvents },
      });
      assert.ok(latest.job);
      assert.equal(latest.job.status, "PASSED");
      assert.equal(latest.compromisedLogs.length, 0);
    }
  );

  await t.test(
    "N2-242: Phát hiện lô đứt mạch hash, đánh dấu COMPROMISED và phát cảnh báo INTEGRITY_BREACH_DETECTED",
    async () => {
      setupS55Dataset();

      const jobResult = await runIntegrityAuditJob({
        batchSize: 1, // Chia nhỏ theo từng lô để kiểm tra batching
        inMemoryContext: {
          inMemoryLots,
          inMemoryBatchEvents,
          inMemoryAuditLogs,
        },
      });

      assert.equal(jobResult.status, "COMPROMISED");
      assert.equal(jobResult.totalLotsScanned, 2);
      assert.equal(jobResult.compromisedLotsCount, 1);

      // Đối soát thông tin lô bị xâm nhập
      const compromised = jobResult.compromisedLots[0];
      assert.equal(compromised.lotId, "LOT-S55-COMPROMISED");
      assert.equal(compromised.errorType, "CONTENT_TAMPERED");
      assert.equal(compromised.firstInvalidSequence, 2);

      // Xác nhận cảnh báo S-31 được phát đến Quản trị viên
      const alertLogs = await getAuditLogs({
        inMemoryLogs: inMemoryAuditLogs,
        action: "INTEGRITY_BREACH_DETECTED",
      });
      assert.equal(alertLogs.total, 1, "Phải phát đúng 1 cảnh báo vi phạm toàn vẹn");
      assert.equal(alertLogs.logs[0].resourceId, "LOT-S55-COMPROMISED");
      assert.equal(alertLogs.logs[0].details.severity, "CRITICAL_ALERT");
    }
  );

  await t.test(
    "N2-285: REST API quản trị /api/admin/integrity-audits/run và /latest (Kiểm tra RBAC)",
    async () => {
      setupS55Dataset();

      // 1. Chưa đăng nhập -> 401
      const unauthRes = await request(app).get("/api/admin/integrity-audits/latest");
      assert.equal(unauthRes.status, 401);

      // 2. Đăng nhập tài khoản thông thường (Producer / User) -> 403 Forbidden
      const userAgent = await loginAs("user@example.com");
      const forbidRes = await userAgent.get("/api/admin/integrity-audits/latest");
      assert.equal(forbidRes.status, 403);

      const forbidPost = await userAgent.post("/api/admin/integrity-audits/run").send({});
      assert.equal(forbidPost.status, 403);

      // 3. Đăng nhập tài khoản Admin -> 200 OK
      const adminAgent = await loginAs("admin@example.com");
      const runRes = await adminAgent.post("/api/admin/integrity-audits/run").send({ batchSize: 5 });
      assert.equal(runRes.status, 200);
      assert.equal(runRes.body.success, true);
      assert.ok(runRes.body.result.jobId.startsWith("JOB-INT-"));

      const latestRes = await adminAgent.get("/api/admin/integrity-audits/latest");
      assert.equal(latestRes.status, 200);
      assert.ok(latestRes.body.job !== undefined);

      const listRes = await adminAgent.get("/api/admin/integrity-audits");
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.jobs));
      assert.ok(listRes.body.jobs.length >= 1);
    }
  );

  await t.test(
    "N2-241-DB-FAILURE: Khi cơ sở dữ liệu PostgreSQL phát sinh lỗi truy vấn, job phải chuyển sang trạng thái FAILED, không được báo PASSED",
    async () => {
      setupS55Dataset();

      // Giả lập pool truy vấn cơ sở dữ liệu bị ngắt kết nối / ném lỗi
      const failingPool = {
        query: async () => {
          throw new Error("connection to server on socket failed: Connection refused (0x0000274D/10061)");
        },
      };

      const result = await runIntegrityAuditJob({
        pool: failingPool,
        batchSize: 10,
        inMemoryContext: {
          inMemoryLots,
          inMemoryBatchEvents,
          inMemoryAuditLogs,
        },
      });

      assert.equal(result.success, false, "Khi CSDL lỗi, kết quả success phải bằng false");
      assert.equal(result.status, "FAILED", "Job phải chuyển trạng thái FAILED thay vì PASSED");
      assert.ok(result.error && result.error.includes("Connection refused"), "Phải ghi nhận chi tiết lỗi CSDL");
      assert.equal(result.totalLotsScanned, 0, "Số lô quét phải bằng 0 khi ngắt kết nối ngay");

      // Kiểm tra API trả về
      const adminAgent = await loginAs("admin@example.com");
      const latestRes = await adminAgent.get("/api/admin/integrity-audits/latest");
      assert.equal(latestRes.status, 200);
      assert.equal(latestRes.body.job.status, "FAILED");
    }
  );
});
