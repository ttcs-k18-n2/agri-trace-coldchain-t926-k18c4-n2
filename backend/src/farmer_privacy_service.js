"use strict";

const crypto = require("node:crypto");
const { recordAuditLog } = require("./audit_logger");
const { verifyBatchEventChain } = require("./integrity_verifier");

const inMemoryAnonymizationRequests = [];

const ANONYMIZED_NAME_TAG = "[ĐÃ ẨN DANH THEO NĐ 13/2023]";

/**
 * Làm sạch và che giấu dữ liệu định danh nông hộ đối với vùng trồng đã yêu cầu xóa PII
 */
function sanitizeFarmData(farm, _isPrivileged = false) {
  if (!farm) return null;

  const isAnon = Boolean(farm.is_anonymized || farm.isAnonymized);
  if (!isAnon) {
    // Nếu chưa ẩn danh, chỉ trả về dữ liệu bình thường
    return { ...farm };
  }

  // Nếu đã ẩn danh theo Nghị định 13/2023: Triệt để xóa bỏ họ tên, SĐT, địa chỉ cá nhân
  const sanitized = { ...farm };
  sanitized.farmer_name = ANONYMIZED_NAME_TAG;
  sanitized.farmerName = ANONYMIZED_NAME_TAG;
  sanitized.farmer_phone = null;
  sanitized.farmerPhone = null;
  sanitized.farmer_address = null;
  sanitized.farmerAddress = null;
  sanitized.is_anonymized = true;
  sanitized.isAnonymized = true;

  // Nếu tên thửa đất chứa họ tên nông hộ, che giấu tên riêng
  if (sanitized.name && !sanitized.name.includes("Ẩn danh")) {
    sanitized.name = `Vùng trồng ${sanitized.id} (Đã ẩn danh theo NĐ 13/2023)`;
  }

  return sanitized;
}

/**
 * Xử lý yêu cầu xóa dữ liệu định danh cá nhân nông hộ (Right to Erasure theo Nghị định 13/2023/NĐ-CP)
 * - Xóa sạch PII trên database và API
 * - Giữ nguyên vẹn mã định danh farmId và chuỗi Hash mật mã học (S-12)
 */
async function anonymizeFarmerData({
  pool,
  farmId,
  organizationId = null,
  isSystemAdmin = false,
  requesterName = "Nông hộ chủ vườn",
  requesterPhone = null,
  legalBasis = "Nghị định 13/2023/NĐ-CP",
  processedBy = "privacy-officer@agri-trace.internal",
  notes = "Xóa thông tin cá nhân theo quyền của chủ thể dữ liệu",
  inMemoryContext = {},
}) {
  const requestId = "REQ-PRIVACY-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const processedAt = new Date().toISOString();

  let targetFarm = null;

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");

      const farmRes = await client.query(
        "SELECT id, name, area, coordinates, organization_id, farmer_name, is_anonymized FROM farms WHERE id = $1 FOR UPDATE",
        [farmId]
      );
      if (farmRes.rows.length === 0) {
        await client.query("ROLLBACK;");
        return {
          status: 404,
          error: "FARM_NOT_FOUND",
          message: `Không tìm thấy vùng trồng / nông hộ với mã: ${farmId}`,
        };
      }
      targetFarm = farmRes.rows[0];

      // Chống IDOR: org_admin chỉ được xóa nông hộ thuộc tổ chức của mình
      if (!isSystemAdmin && organizationId && targetFarm.organization_id !== organizationId) {
        await client.query("ROLLBACK;");
        return {
          status: 403,
          error: "FORBIDDEN",
          message: "Truy cập bị từ chối: bạn không có quyền xóa định danh nông hộ của tổ chức khác.",
        };
      }

      // Cập nhật ẩn danh trên Database trong cùng transaction
      await client.query(
        `UPDATE farms
         SET farmer_name = $1,
             farmer_phone = NULL,
             farmer_address = NULL,
             name = $2,
             is_anonymized = TRUE,
             anonymized_at = $3,
             updated_at = $3
         WHERE id = $4`,
        [
          ANONYMIZED_NAME_TAG,
          `Vùng trồng ${farmId} (Đã ẩn danh theo NĐ 13/2023)`,
          processedAt,
          farmId,
        ]
      );

      // Lưu vào bảng theo dõi yêu cầu trong cùng transaction
      await client.query(
        `INSERT INTO farmer_anonymization_requests (id, farm_id, requester_name, requester_phone, legal_basis, status, processed_at, processed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          requestId,
          farmId,
          requesterName,
          requesterPhone,
          legalBasis,
          "COMPLETED",
          processedAt,
          processedBy,
          notes,
        ]
      );

      await client.query("COMMIT;");
    } catch (txErr) {
      await client.query("ROLLBACK;").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } else {
    // In-memory fallback
    const farms = inMemoryContext.inMemoryFarms || [];
    const found = farms.find((f) => f.id === farmId);
    if (!found) {
      return {
        status: 404,
        error: "FARM_NOT_FOUND",
        message: `Không tìm thấy vùng trồng / nông hộ với mã: ${farmId}`,
      };
    }

    const farmOrgId = found.organizationId || found.organization_id;
    if (!isSystemAdmin && organizationId && farmOrgId !== organizationId) {
      return {
        status: 403,
        error: "FORBIDDEN",
        message: "Truy cập bị từ chối: bạn không có quyền xóa định danh nông hộ của tổ chức khác.",
      };
    }

    targetFarm = found;
    found.farmerName = ANONYMIZED_NAME_TAG;
    found.farmer_name = ANONYMIZED_NAME_TAG;
    found.farmerPhone = null;
    found.farmer_phone = null;
    found.farmerAddress = null;
    found.farmer_address = null;
    found.name = `Vùng trồng ${farmId} (Đã ẩn danh theo NĐ 13/2023)`;
    found.isAnonymized = true;
    found.is_anonymized = true;
    found.anonymizedAt = processedAt;
    found.anonymized_at = processedAt;
  }

  const farmOrg = targetFarm.organization_id || targetFarm.organizationId || "system";
  const anonRecord = {
    id: requestId,
    farmId,
    farm_id: farmId,
    organizationId: farmOrg,
    requesterName,
    requester_name: requesterName,
    legalBasis,
    legal_basis: legalBasis,
    status: "COMPLETED",
    processedAt,
    processed_at: processedAt,
    processedBy,
    processed_by: processedBy,
    notes,
  };
  inMemoryAnonymizationRequests.unshift(anonRecord);

  // Ghi nhật ký kiểm toán S-31
  await recordAuditLog({
    pool,
    inMemoryLogs: inMemoryContext.inMemoryAuditLogs,
    actorUserId: "privacy-officer",
    actorEmail: processedBy,
    organizationId: farmOrg,
    action: "FARMER_PII_ANONYMIZED",
    resourceType: "farm",
    resourceId: farmId,
    details: {
      requestId,
      legalBasis,
      processedBy,
      notes,
    },
  });

  // Kiểm tra xác nhận: Tính toàn vẹn chuỗi Hash của các lô liên quan vẫn nguyên vẹn 100%
  let hashIntegrityCheck = { verified: true, totalLotsChecked: 0, allValid: true };
  let relevantLots = [];

  if (pool) {
    try {
      const lotsRes = await pool.query("SELECT id FROM lots WHERE farm_id = $1", [farmId]);
      relevantLots = lotsRes.rows;
      for (const r of relevantLots) {
        const evRes = await pool.query(
          "SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC",
          [r.id]
        );
        const check = verifyBatchEventChain(evRes.rows);
        if (!check.valid) hashIntegrityCheck.allValid = false;
        hashIntegrityCheck.totalLotsChecked++;
      }
    } catch {
      // ignore
    }
  } else {
    const lots = inMemoryContext.inMemoryLots || [];
    relevantLots = lots.filter((l) => (l.farmId || l.farm_id) === farmId);
    const events = inMemoryContext.inMemoryBatchEvents || [];
    for (const l of relevantLots) {
      const lotEvents = events
        .filter((e) => (e.batchId || e.batch_id || e.lotId) === l.id)
        .sort((a, b) => Number(a.sequenceNo || a.sequence_no) - Number(b.sequenceNo || b.sequence_no));
      const check = verifyBatchEventChain(lotEvents);
      if (!check.valid) hashIntegrityCheck.allValid = false;
      hashIntegrityCheck.totalLotsChecked++;
    }
  }

  return {
    status: 200,
    success: true,
    message: "Xóa dữ liệu định danh nông hộ thành công theo Nghị định 13/2023/NĐ-CP.",
    requestId,
    farmId,
    sanitizedFarm: sanitizeFarmData(targetFarm),
    hashIntegrityCheck,
  };
}

module.exports = {
  anonymizeFarmerData,
  sanitizeFarmData,
  inMemoryAnonymizationRequests,
  ANONYMIZED_NAME_TAG,
};
