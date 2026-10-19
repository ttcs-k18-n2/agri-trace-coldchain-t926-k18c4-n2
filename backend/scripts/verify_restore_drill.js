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

  const farms = [
    {
      id: "FARM-DL-01",
      name: "Nông trại Dâu tây Langbiang 01",
      area: 2.5,
      coordinates: "11.9545, 108.4412",
      organizationId: "org-001",
      farmerName: "Nguyễn Văn A",
      farmerPhone: "0912345678",
      farmerAddress: "Thị trấn Lạc Dương, Lâm Đồng",
      isAnonymized: false,
    },
  ];

  const lots = [
    {
      id: "LOT-DRILL-01",
      code: "LOT-DRILL-01",
      name: "Dâu tây New Zealand",
      status: "COMPLETED",
      organizationId: "org-001",
      farmId: "FARM-DL-01",
    },
    {
      id: "LOT-DRILL-02",
      code: "LOT-DRILL-02",
      name: "Cà chua bi Cherry",
      status: "IN_TRANSIT",
      organizationId: "org-001",
      farmId: "FARM-DL-01",
    },
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
      coldBoxId: "BOX-DRILL-01",
      transporterId: "org-trans-01",
      organizationId: "org-001",
      status: "COMPLETED",
      createdAt: "2026-10-18T08:30:00Z",
    },
  ];

  const violations = [
    {
      id: "VIO-DRILL-01",
      shipmentId: "SHIP-DRILL-01",
      coldBoxId: "BOX-DRILL-01",
      organizationId: "org-001",
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
    inMemoryFarms: farms,
    inMemoryLots: lots,
    inMemoryBatchEvents: events,
    inMemoryShipments: shipments,
    inMemoryViolations: violations,
    inMemoryAnonymizationRequests: anonymizationRequests,
  };
}

/**
 * Đối soát khóa ngoại giữa các bảng đã phục hồi
 */
function verifyForeignKeys(target) {
  const orgIds = new Set((target.inMemoryOrgs || []).map((o) => o.id));
  const farmIds = new Set((target.inMemoryFarms || []).map((f) => f.id));
  const lotIds = new Set((target.inMemoryLots || []).map((l) => l.id));
  const shipmentIds = new Set((target.inMemoryShipments || []).map((s) => s.id));

  // Kiểm tra farms -> organizations
  for (const f of target.inMemoryFarms || []) {
    const orgId = f.organizationId || f.organization_id;
    if (orgId && !orgIds.has(orgId)) {
      return { valid: false, error: `Farm ${f.id} tham chiếu organizationId không tồn tại: ${orgId}` };
    }
  }

  // Kiểm tra lots -> organizations & farms
  for (const l of target.inMemoryLots || []) {
    const orgId = l.organizationId || l.organization_id;
    if (orgId && !orgIds.has(orgId)) {
      return { valid: false, error: `Lot ${l.id} tham chiếu organizationId không tồn tại: ${orgId}` };
    }
    const farmId = l.farmId || l.farm_id;
    if (farmId && !farmIds.has(farmId)) {
      return { valid: false, error: `Lot ${l.id} tham chiếu farmId không tồn tại: ${farmId}` };
    }
  }

  // Kiểm tra batch_events -> lots & organizations
  for (const ev of target.inMemoryBatchEvents || []) {
    const bId = ev.batchId || ev.batch_id || ev.lot_id;
    if (bId && !lotIds.has(bId)) {
      return { valid: false, error: `Event ${ev.id} tham chiếu batchId/lotId không tồn tại: ${bId}` };
    }
    const orgId = ev.organizationId || ev.organization_id;
    if (orgId && !orgIds.has(orgId)) {
      return { valid: false, error: `Event ${ev.id} tham chiếu organizationId không tồn tại: ${orgId}` };
    }
  }

  // Kiểm tra violations -> shipments
  for (const v of target.inMemoryViolations || []) {
    const sId = v.shipmentId || v.shipment_id;
    if (sId && !shipmentIds.has(sId)) {
      return { valid: false, error: `Violation ${v.id} tham chiếu shipmentId không tồn tại: ${sId}` };
    }
  }

  // Kiểm tra anonymization requests -> farms
  for (const r of target.inMemoryAnonymizationRequests || []) {
    const farmId = r.farmId || r.farm_id;
    if (farmId && !farmIds.has(farmId)) {
      return { valid: false, error: `AnonymizationRequest ${r.id} tham chiếu farmId không tồn tại: ${farmId}` };
    }
  }

  return { valid: true };
}

/**
 * Diễn tập kịch bản ngoại lệ 1: Khóa giải mã sai (wrong key)
 */
async function verifyWrongKeyScenario(filePath) {
  try {
    await restoreBackup(filePath, {
      encryptionKey: "wrong-encryption-key-for-drill!",
      targetInMemory: {},
    });
    return { passed: false, error: "Hệ thống không phát hiện khóa giải mã sai" };
  } catch (err) {
    const isExpected =
      err.message.includes("Giải mã thất bại") ||
      err.message.includes("bad decrypt") ||
      err.message.includes("Unsupported state");
    return {
      passed: isExpected,
      detectedError: err.message,
    };
  }
}

/**
 * Diễn tập kịch bản ngoại lệ 2: Tệp backup bị sửa đổi ciphertext (tampered ciphertext)
 */
async function verifyTamperedCiphertextScenario(filePath, encryptionKey, tempDir) {
  try {
    const fileContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rawCiphertext = Buffer.from(fileContent.ciphertext, "base64");
    rawCiphertext[0] = rawCiphertext[0] ^ 0xff; // Đảo bit ciphertext
    fileContent.ciphertext = rawCiphertext.toString("base64");

    const tamperedPath = path.join(tempDir, "tampered-ciphertext-" + Date.now() + ".enc");
    fs.writeFileSync(tamperedPath, JSON.stringify(fileContent, null, 2), "utf8");

    try {
      await restoreBackup(tamperedPath, {
        encryptionKey,
        targetInMemory: {},
      });
      return { passed: false, error: "Hệ thống không phát hiện dữ liệu ciphertext bị giả mạo" };
    } catch (err) {
      const isExpected =
        err.message.includes("Giải mã thất bại") ||
        err.message.includes("bad decrypt") ||
        err.message.includes("Checksum SHA-256 không khớp");
      return {
        passed: isExpected,
        detectedError: err.message,
      };
    } finally {
      if (fs.existsSync(tamperedPath)) {
        try { fs.unlinkSync(tamperedPath); } catch {}
      }
    }
  } catch (err) {
    return { passed: false, error: err.message };
  }
}

/**
 * Diễn tập kịch bản ngoại lệ 3: Tệp backup bị sửa đổi authTag (tampered authTag)
 */
async function verifyTamperedAuthTagScenario(filePath, encryptionKey, tempDir) {
  try {
    const fileContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const originalTag = fileContent.metadata.authTag || "";
    // Đảo ký tự đầu của authTag
    const tamperedTag = (originalTag[0] === "a" ? "b" : "a") + originalTag.slice(1);
    fileContent.metadata.authTag = tamperedTag;

    const tamperedPath = path.join(tempDir, "tampered-authtag-" + Date.now() + ".enc");
    fs.writeFileSync(tamperedPath, JSON.stringify(fileContent, null, 2), "utf8");

    try {
      await restoreBackup(tamperedPath, {
        encryptionKey,
        targetInMemory: {},
      });
      return { passed: false, error: "Hệ thống không phát hiện authTag bị giả mạo" };
    } catch (err) {
      const isExpected =
        err.message.includes("Giải mã thất bại") ||
        err.message.includes("bad decrypt") ||
        err.message.includes("Unsupported state");
      return {
        passed: isExpected,
        detectedError: err.message,
      };
    } finally {
      if (fs.existsSync(tamperedPath)) {
        try { fs.unlinkSync(tamperedPath); } catch {}
      }
    }
  } catch (err) {
    return { passed: false, error: err.message };
  }
}

/**
 * Diễn tập kịch bản ngoại lệ 4: Lỗi rollback transaction khi có lỗi trong quá trình khôi phục
 */
async function verifyTransactionRollbackScenario(filePath, encryptionKey) {
  let beginExecuted = false;
  let rollbackExecuted = false;
  let errorCaught = false;

  const mockClient = {
    query: async (sql) => {
      if (sql === "BEGIN;") beginExecuted = true;
      if (sql === "ROLLBACK;") rollbackExecuted = true;
      if (sql.includes("lots") && sql.includes("INSERT")) {
        throw new Error("Lỗi giả lập vi phạm toàn vẹn khi insert vào lots");
      }
      return { rowCount: 1 };
    },
    release: () => {},
  };

  const mockPool = {
    connect: async () => mockClient,
  };

  try {
    await restoreBackup(filePath, {
      encryptionKey,
      pool: mockPool,
    });
  } catch (err) {
    errorCaught = true;
    if (!err.message.includes("Restore Transaction Rollback")) {
      return { passed: false, error: `Thông điệp lỗi không đúng mong đợi: ${err.message}` };
    }
  }

  return {
    passed: beginExecuted && rollbackExecuted && errorCaught,
    beginExecuted,
    rollbackExecuted,
    errorCaught,
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
    inMemoryFarms: [],
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
  const fkCheck = verifyForeignKeys(sandboxTarget);
  const checks = {
    orgsParity: (sandboxTarget.inMemoryOrgs || []).length === (mockContext.inMemoryOrgs || []).length,
    farmsParity: (sandboxTarget.inMemoryFarms || []).length === (mockContext.inMemoryFarms || []).length,
    lotsParity: (sandboxTarget.inMemoryLots || []).length === (mockContext.inMemoryLots || []).length,
    eventsParity: (sandboxTarget.inMemoryBatchEvents || []).length === (mockContext.inMemoryBatchEvents || []).length,
    shipmentsParity: (sandboxTarget.inMemoryShipments || []).length === (mockContext.inMemoryShipments || []).length,
    violationsParity: (sandboxTarget.inMemoryViolations || []).length === (mockContext.inMemoryViolations || []).length,
    anonymizationParity:
      (sandboxTarget.inMemoryAnonymizationRequests || []).length ===
      (mockContext.inMemoryAnonymizationRequests || []).length,
    foreignKeysValid: fkCheck.valid,
    hashIntegrityPassed: Boolean(restoreRes.integrityVerification && restoreRes.integrityVerification.passed),
  };

  // 5. Diễn tập các kịch bản ngoại lệ
  console.log(`[Diễn tập S-57] Bước 4: Kiểm tra các kịch bản ngoại lệ (Exception Scenarios)...`);
  const exceptionScenarios = {
    wrongKey: await verifyWrongKeyScenario(backupRes.filePath),
    tamperedCiphertext: await verifyTamperedCiphertextScenario(backupRes.filePath, encryptionKey, tempDir),
    tamperedAuthTag: await verifyTamperedAuthTagScenario(backupRes.filePath, encryptionKey, tempDir),
    transactionRollback: await verifyTransactionRollbackScenario(backupRes.filePath, encryptionKey),
  };

  const allChecksPassed = Object.values(checks).every(Boolean);
  const allExceptionsPassed =
    exceptionScenarios.wrongKey.passed &&
    exceptionScenarios.tamperedCiphertext.passed &&
    exceptionScenarios.tamperedAuthTag.passed &&
    exceptionScenarios.transactionRollback.passed;

  const drillStatus = (allChecksPassed && allExceptionsPassed) ? "DRILL_PASSED" : "DRILL_FAILED";
  const totalDrillDurationMs = Date.now() - drillStartTime;

  const drillReport = {
    drillId,
    timestamp: new Date().toISOString(),
    status: drillStatus,
    rtoDurationMs: restoreDurationMs,
    rtoDurationSeconds: Number((restoreDurationMs / 1000).toFixed(3)),
    rpoPoint: backupRes.filename,
    tableCountsRestored: restoreRes.tableCounts,
    integrityVerification: restoreRes.integrityVerification,
    checks,
    exceptionScenarios,
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
  console.log(`[Diễn tập S-57] Kịch bản ngoại lệ: ${allExceptionsPassed ? "TẤT CẢ ĐÃ VƯỢT QUA" : "CÓ LỖI"}`);

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
  verifyForeignKeys,
  verifyWrongKeyScenario,
  verifyTamperedCiphertextScenario,
  verifyTamperedAuthTagScenario,
  verifyTransactionRollbackScenario,
};
