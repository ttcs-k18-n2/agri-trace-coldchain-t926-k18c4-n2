"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const {
  app,
  seedDemoUser,
  inMemoryLots,
  inMemoryFarms,
  inMemoryProducts,
  inMemoryOrgs,
  inMemoryBatchEvents,
  inMemoryRecallOrders,
  inMemoryAuditLogs,
} = require("../src/server");
const { inMemoryViolations } = require("../src/cold_chain_violation_service");
const { exportLotDossierToPdf } = require("../src/lot_pdf_export_service");
const { calculateEventHash, GENESIS_HASH } = require("../src/integrity");
const { getAuditLogs } = require("../src/audit_logger");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

function setupS53Dataset() {
  inMemoryLots.length = 0;
  inMemoryFarms.length = 0;
  inMemoryProducts.length = 0;
  inMemoryOrgs.length = 0;
  inMemoryBatchEvents.length = 0;
  inMemoryViolations.length = 0;
  inMemoryRecallOrders.length = 0;
  inMemoryAuditLogs.length = 0;

  // Organizations
  inMemoryOrgs.push(
    { id: "org-001", name: "HTX Nông nghiệp Đà Lạt Hữu Cơ", type: "cooperative" },
    { id: "org-inspector", name: "Cục Kiểm tra An toàn Thực phẩm", type: "inspector" }
  );

  // Farms & Products
  inMemoryFarms.push({ id: "FARM-DL-01", name: "Vườn rau hữu cơ Thung Lũng Vàng", organizationId: "org-001" });
  inMemoryProducts.push({ id: "PROD-TOMATO", name: "Cà chua bi hữu cơ", unit: "kg" });

  // Lots
  inMemoryLots.push({
    id: "LOT-S53-VERIFIED",
    code: "LOT-S53-VERIFIED",
    name: "Cà chua bi thu hoạch đợt 1",
    organizationId: "org-001",
    farmId: "FARM-DL-01",
    productId: "PROD-TOMATO",
    initialQuantity: 1000,
    remainingQuantity: 850,
    harvestedAt: "2026-10-10",
    createdAt: "2026-10-10T07:00:00.000Z",
    status: "Đang lưu thông",
  });

  // Valid Event Hash Chain
  const ev1Data = {
    batchId: "LOT-S53-VERIFIED",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-10T07:00:00.000Z",
    payload: { farmId: "FARM-DL-01", quantityKg: 1000 },
  };
  const ev1Hash = calculateEventHash(GENESIS_HASH, ev1Data);

  const ev2Data = {
    batchId: "LOT-S53-VERIFIED",
    sequenceNo: 2,
    eventType: "TEMPERATURE_RECORDED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-10T09:00:00.000Z",
    payload: { temperatureC: 4.5, humidityPercent: 85 },
  };
  const ev2Hash = calculateEventHash(ev1Hash, ev2Data);

  inMemoryBatchEvents.push(
    {
      id: "ev-s53-1",
      ...ev1Data,
      previousHash: GENESIS_HASH,
      eventHash: ev1Hash,
    },
    {
      id: "ev-s53-2",
      ...ev2Data,
      previousHash: ev1Hash,
      eventHash: ev2Hash,
    }
  );

  return { ev1Hash, ev2Hash };
}

test("Story S-53: Xuất hồ sơ truy xuất đầy đủ của một lô ra PDF kèm kết quả kiểm toàn vẹn (Jira N2-121)", async (t) => {
  await seedDemoUser();

  await t.test(
    "N2-237: Kết xuất hồ sơ PDF hợp lệ (chuẩn PDF-1.4, header binary %PDF và trailer %%EOF)",
    async () => {
      setupS53Dataset();

      const result = await exportLotDossierToPdf({
        lotId: "LOT-S53-VERIFIED",
        actorEmail: "inspector@example.com",
        inMemoryContext: {
          inMemoryLots,
          inMemoryOrgs,
          inMemoryFarms,
          inMemoryProducts,
          inMemoryBatchEvents,
          inMemoryViolations,
          inMemoryRecallOrders,
        },
      });

      assert.equal(result.status, 200);
      assert.equal(result.contentType, "application/pdf");
      assert.ok(result.filename.endsWith(".pdf"));
      assert.ok(Buffer.isBuffer(result.pdfBuffer), "Kết quả phải là một Buffer nhị phân");

      // Đối soát tiêu chuẩn PDF
      const pdfStr = result.pdfBuffer.toString("latin1");
      assert.ok(pdfStr.startsWith("%PDF-1.4"), "Tệp PDF phải bắt đầu bằng magic header %PDF-1.4");
      assert.ok(pdfStr.trim().endsWith("%%EOF"), "Tệp PDF phải kết thúc bằng %%EOF");
      assert.ok(pdfStr.includes("/Root"), "Tệp PDF phải có Root catalog");
      assert.ok(pdfStr.includes("xref"), "Tệp PDF phải có bảng tham chiếu xref");
    }
  );

  await t.test(
    "N2-238: Nội dung PDF chứa đầy đủ thông tin lô, phả hệ, chuỗi lạnh, thu hồi và in Head Hash",
    async () => {
      const { ev2Hash } = setupS53Dataset();

      const result = await exportLotDossierToPdf({
        lotId: "LOT-S53-VERIFIED",
        actorEmail: "inspector@example.com",
        inMemoryContext: {
          inMemoryLots,
          inMemoryOrgs,
          inMemoryFarms,
          inMemoryProducts,
          inMemoryBatchEvents,
          inMemoryViolations,
          inMemoryRecallOrders,
        },
      });

      const pdfStr = result.pdfBuffer.toString("latin1");

      // 1. Thông tin lô hàng
      assert.ok(pdfStr.includes("LOT-S53-VERIFIED"), "Phải chứa mã lô hàng");
      assert.ok(pdfStr.includes("Ca chua bi"), "Phải chứa tên sản phẩm");
      assert.ok(pdfStr.includes("Thung Lung Vang"), "Phải chứa tên vùng trồng");

      // 2. Kiểm tra toàn vẹn và Head Hash (NFR N2-121)
      assert.equal(result.integrityValid, true, "Chuỗi sự kiện phải hợp lệ");
      assert.equal(result.headHash, ev2Hash, "Head Hash phải khớp với mã băm sự kiện cuối");
      assert.ok(pdfStr.includes(ev2Hash), "Phải in chính xác mã băm đỉnh 64 ký tự lên hồ sơ PDF");
      assert.ok(pdfStr.includes("TOAN VEN"), "Phải có trạng thái toàn vẹn ĐẠT TIÊU CHUẨN");

      // 3. Phả hệ & Chuỗi lạnh & Thu hồi
      assert.ok(pdfStr.includes("PHA HE NGUON GOC"), "Phải có phần phả hệ");
      assert.ok(pdfStr.includes("GIAM SAT CHUOI LANH"), "Phải có phần giám sát chuỗi lạnh");
      assert.ok(pdfStr.includes("TINH TRANG THU HOI"), "Phải có phần tình trạng thu hồi");
    }
  );

  await t.test(
    "N2-284: REST API GET /api/lots/:id/export-pdf, kiểm tra RBAC và ghi nhật ký kiểm toán S-31",
    async () => {
      setupS53Dataset();

      // 1. Chưa đăng nhập -> 401
      const unauthRes = await request(app).get("/api/lots/LOT-S53-VERIFIED/export-pdf");
      assert.equal(unauthRes.status, 401);

      // 2. Đăng nhập Cán bộ kiểm tra -> 200, Content-Type application/pdf
      const inspectorAgent = await loginAs("inspector@example.com");
      const exportRes = await inspectorAgent.get("/api/lots/LOT-S53-VERIFIED/export-pdf");
      assert.equal(exportRes.status, 200);
      assert.equal(exportRes.headers["content-type"], "application/pdf");
      assert.ok(exportRes.headers["content-disposition"].includes("Ho-So-Truy-Xuat-LOT-S53-VERIFIED.pdf"));
      assert.ok(exportRes.headers["x-lot-head-hash"].length === 64);
      assert.equal(exportRes.headers["x-integrity-valid"], "true");

      // 3. Kiểm tra ghi nhận S-31 nhật ký kiểm toán
      const auditRes = await getAuditLogs({
        inMemoryLogs: inMemoryAuditLogs,
        action: "INSPECTOR_LOT_PDF_EXPORT",
      });
      assert.equal(auditRes.total, 1, "Phải ghi nhận đúng 1 log INSPECTOR_LOT_PDF_EXPORT");
      assert.equal(auditRes.logs[0].actorEmail, "inspector@example.com");
      assert.equal(auditRes.logs[0].resourceId, "LOT-S53-VERIFIED");
      assert.equal(auditRes.logs[0].details.integrityValid, true);

      // 4. Lô không tồn tại -> 404 chuẩn
      const notFoundRes = await inspectorAgent.get("/api/lots/LOT-NOT-EXIST/export-pdf");
      assert.equal(notFoundRes.status, 404);
      assert.equal(notFoundRes.body.error, "LOT_NOT_FOUND");
    }
  );
});
