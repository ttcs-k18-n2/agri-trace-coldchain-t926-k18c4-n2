"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { runNightlyBackup } = require("./backup_nightly");
const { restoreBackup } = require("./restore_backup");
const { calculateEventHash, GENESIS_HASH } = require("../src/integrity");

/**
 * Tạo dữ liệu mẫu chuỗi lạnh có tính toàn vẹn cao để diễn tập khôi phục
 */
function createDrillMockContext() {
  const orgs = [
    { id: "org-001", name: "HTX Nông nghiệp Sạch Đà Lạt", type: "cooperative" },
    { id: "org-trans-01", name: "Vận tải Lạnh Ánh Dương", type: "transporter" },
    { id: "org-dist-01", name: "Tổng kho Phân phối BigC", type: "distributor" },
  ];

  const lots = [
    { id: "LOT-DRILL-01", code: "LOT-DRILL-01", name: "Dâu tây New Zealand", status: "COMPLETED", organizationId: "org-001" },
    { id: "LOT-DRILL-02", code: "LOT-DRILL-02", name: "Cà chua bi Cherry", status: "IN_TRANSIT", organizationId: "org-001" },
  ];

  // Sự kiện có mã băm nối vòng hợp lệ chuẩn K-01
  const ev1Data = {
    batchId: "LOT-DRILL-01",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-18T06:00:00.000Z",
    payload: { farmId: "FARM-DL-01", quantityKg: 500 },
  };
  const ev1Hash = calculateEventHash(GENESIS_HASH, ev1Data);

  const ev2Data = {
    batchId: "LOT-DRILL-01",
    sequenceNo: 2,
    eventType: "DISPATCHED",
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-18T08:30:00.000Z",
    payload: { transporterId: "org-trans-01", vehiclePlate: "49C-12345" },
  };
  const ev2Hash = calculateEventHash(ev1Hash, ev2Data);

  const events = [
    {
      id: "ev-01",
      ...ev1Data,
      previousHash: GENESIS_HASH,
      eventHash: ev1Hash,
    },
    {
      id: "ev-02",
      ...ev2Data,
      previousHash: ev1Hash,
      eventHash: ev2Hash,
    },
  ];

  const shipments = [
    {
      id: "SHIP-DRILL-01",
      transporterId: "org-trans-01",
      status: "COMPLETED",
      createdAt: "2026-10-18T08:30:00Z",
    },
  ];

  const violations = [
    {
      id: "VIO-DRILL-01",
      shipmentId: "SHIP-DRILL-01",
      severity: "WARNING",
      durationMinutes: 15,
      createdAt: "2026-10-18T09:00:00Z",
    },
  ];

  const anonymizationRequests = [
    {
      id: "REQ-DRILL-001",
      farmId: "FARM-DL-01",
      requesterName: "Nông hộ chủ vườn Nguyễn Văn A",
      legalBasis: "Nghị định 13/2023/NĐ-CP",
      status: "COMPLETED",
      processedAt: "2026-10-18T07:00:00.000Z",
      processedBy: "privacy-officer@agri-trace.internal",
      notes: "Yêu cầu ẩn danh theo quyền chủ thể dữ liệu",
    },
  ];

  return {
    inMemoryOrgs: orgs,
    inMemoryLots: lots,
    inMemoryBatchEvents: events,
    inMemoryShipments: shipments,
    inMemoryViolations: violations,
    inMemoryAnonymizationRequests: anonymizationRequests,
  };
}

/**
 * Thực hiện kịch bản diễn tập khôi phục trên môi trường tạm
 */
async function runRestoreDrill(options = {}) {
  const drillId = "DRILL-" + Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coldchain-drill-"));
  const drillStartTime = Date.now();
  const encryptionKey =
    options.encryptionKey ||
    process.env.BACKUP_ENCRYPTION_KEY ||
    ("drill-secret-" + crypto.randomBytes(16).toString("hex"));

  console.log(`[Diễn tập S-57] Bắt đầu diễn tập khôi phục thảm họa (Drill ID: ${drillId})`);
  console.log(`[Diễn tập S-57] Môi trường tạm biệt lập: ${tempDir}`);

  // 1. Tạo snapshot dữ liệu mẫu
  const mockContext = options.mockContext || createDrillMockContext();
  console.log(`[Diễn tập S-57] Bước 1: Tiến hành sao lưu toàn bộ dữ liệu nguồn...`);
  
  const backupRes = await runNightlyBackup({
    backupDir: tempDir,
    encryptionKey,
    inMemoryContext: mockContext,
  });

  console.log(`[Diễn tập S-57] Sao lưu thành công: ${backupRes.filename} (Kích thước: ${backupRes.fileSize} bytes)`);

  // 2. Chuẩn bị môi trường tạm sạch
  const sandboxTarget = {
    inMemoryOrgs: [],
    inMemoryLots: [],
    inMemoryBatchEvents: [],
    inMemoryShipments: [],
    inMemoryViolations: [],
    inMemoryAnonymizationRequests: [],
  };

  // 3. Khôi phục lên môi trường tạm & đo thời gian
  console.log(`[Diễn tập S-57] Bước 2: Thực hiện lệnh khôi phục vào môi trường tạm...`);
  const restoreStart = Date.now();

  const restoreRes = await restoreBackup(backupRes.filePath, {
    encryptionKey,
    targetInMemory: sandboxTarget,
    skipVerification: false,
  });

  const restoreDurationMs = Date.now() - restoreStart;
  console.log(`[Diễn tập S-57] Khôi phục hoàn tất trong: ${restoreDurationMs} ms`);

  // 4. Đối soát dữ liệu sau khôi phục
  console.log(`[Diễn tập S-57] Bước 3: Đối soát tính toàn vẹn và độ chính xác dữ liệu...`);
  const checks = {
    orgsParity: sandboxTarget.inMemoryOrgs.length === mockContext.inMemoryOrgs.length,
    lotsParity: sandboxTarget.inMemoryLots.length === mockContext.inMemoryLots.length,
    eventsParity: sandboxTarget.inMemoryBatchEvents.length === mockContext.inMemoryBatchEvents.length,
    shipmentsParity: sandboxTarget.inMemoryShipments.length === mockContext.inMemoryShipments.length,
    violationsParity: sandboxTarget.inMemoryViolations.length === mockContext.inMemoryViolations.length,
    anonymizationParity:
      (sandboxTarget.inMemoryAnonymizationRequests || []).length ===
      (mockContext.inMemoryAnonymizationRequests || []).length,
    hashIntegrityPassed: restoreRes.integrityVerification.passed,
  };

  const allPassed = Object.values(checks).every(Boolean);
  const totalDrillDurationMs = Date.now() - drillStartTime;

  const drillReport = {
    drillId,
    timestamp: new Date().toISOString(),
    status: allPassed ? "DRILL_PASSED" : "DRILL_FAILED",
    rtoDurationMs: restoreDurationMs,
    rtoDurationSeconds: Number((restoreDurationMs / 1000).toFixed(3)),
    rpoPoint: backupRes.filename,
    tableCountsRestored: restoreRes.tableCounts,
    integrityVerification: restoreRes.integrityVerification,
    checks,
    totalDrillDurationMs,
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
      sandboxPath: tempDir,
    },
  };

  // Dọn dẹp môi trường tạm sau khi diễn tập
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }

  // Ghi nhật ký bằng chứng diễn tập
  const evidenceDir = path.resolve(__dirname, "../../docs");
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, "DRILL_RESTORE_EVIDENCE.json"),
    JSON.stringify(drillReport, null, 2),
    "utf8"
  );

  console.log(`[Diễn tập S-57] Kết quả diễn tập: ${drillReport.status}`);
  console.log(`[Diễn tập S-57] Thời gian khôi phục (RTO): ${drillReport.rtoDurationSeconds}s`);
  console.log(`[Diễn tập S-57] Toàn vẹn chuỗi hash: ${checks.hashIntegrityPassed ? "HOÀN HẢO" : "THẤT BẠI"}`);

  return drillReport;
}

if (require.main === module) {
  runRestoreDrill()
    .then((rep) => {
      if (rep.status === "DRILL_PASSED") process.exit(0);
      else process.exit(1);
    })
    .catch((err) => {
      console.error("[Drill Error]:", err);
      process.exit(1);
    });
}

module.exports = {
  runRestoreDrill,
  createDrillMockContext,
};
