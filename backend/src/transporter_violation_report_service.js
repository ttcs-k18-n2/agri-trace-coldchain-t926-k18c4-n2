/**
 * Service tổng hợp thống kê vi phạm chuỗi lạnh theo đơn vị vận chuyển (Story S-54 / Jira N2-122)
 *
 * Nghiệp vụ cốt lõi:
 * 1. Báo cáo theo kỳ (fromDate, toDate):
 *    - Số chuyến vận chuyển (totalShipments)
 *    - Số chuyến có vi phạm nhiệt độ (violatedShipments)
 *    - Tổng số sự cố vi phạm (violationCount)
 *    - Tổng thời lượng vi phạm (totalViolationMinutes)
 *    - Tỉ lệ chuyến có vi phạm (violationRate = violatedShipments / totalShipments * 100)
 * 2. Bảo mật đa tổ chức (T-12 Tenant Isolation):
 *    - Nhà phân phối (hoặc HTX) chỉ thống kê các chuyến có chở lô hàng thuộc tổ chức của mình.
 *    - Không được làm rò rỉ các chuyến hoặc thông tin của tổ chức khác.
 *    - Quản trị viên (admin) hoặc cán bộ kiểm tra (inspector) có thể xem thống kê toàn hệ thống
 *      hoặc lọc theo tổ chức cụ thể.
 */

const { inMemoryShipments, inMemoryShipmentLots } = require("./shipment_service");
const { inMemoryViolations } = require("./cold_chain_violation_service");

/**
 * Lấy danh sách tên tổ chức từ DB hoặc in-memory
 */
async function getOrganizationNameMap(pool, inMemoryOrgs = []) {
  const map = new Map();
  if (Array.isArray(inMemoryOrgs)) {
    for (const org of inMemoryOrgs) {
      if (org && org.id) {
        map.set(org.id, org.name || org.id);
      }
    }
  }

  if (pool && typeof pool.query === "function") {
    try {
      const res = await pool.query("SELECT id, name FROM organizations");
      for (const row of res.rows) {
        map.set(row.id, row.name || row.id);
      }
    } catch (err) {
      console.error("[getOrganizationNameMap DB Error, using in-memory]:", err.message);
    }
  }

  return map;
}

/**
 * Tổng hợp dữ liệu thống kê vi phạm theo đơn vị vận chuyển
 */
async function getTransporterViolationReport({
  pool = null,
  authContext = null,
  fromDate = null,
  toDate = null,
  targetOrgId = null,
  inMemoryShipmentsList = null,
  inMemoryShipmentLotsList = null,
  inMemoryViolationsList = null,
  inMemoryLotsList = null,
  inMemoryOrgsList = null,
}) {
  const isGlobalViewer = Boolean(
    authContext?.roleId === "admin" ||
    authContext?.roleId === "inspector" ||
    authContext?.role === "admin" ||
    authContext?.role === "inspector" ||
    authContext?.isInspector
  );

  const viewerOrgId = authContext?.organizationId || authContext?.organization_id;

  // Nếu không phải admin/inspector, bắt buộc phải có tổ chức và chỉ xem lô của mình
  if (!isGlobalViewer && !viewerOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN_TENANT_ACCESS",
      message: "Không xác định được tổ chức của người dùng để trích xuất báo cáo.",
    };
  }

  const effectiveTenantFilter = isGlobalViewer ? (targetOrgId || null) : viewerOrgId;

  const orgMap = await getOrganizationNameMap(pool, inMemoryOrgsList);

  // Parse thời gian lọc
  let fromTimestamp = null;
  let toTimestamp = null;
  if (fromDate) {
    const f = new Date(fromDate);
    if (!isNaN(f.getTime())) fromTimestamp = f;
  }
  if (toDate) {
    const t = new Date(toDate);
    if (!isNaN(t.getTime())) {
      // Đặt tới cuối ngày nếu chỉ có ngày
      if (typeof toDate === "string" && !toDate.includes("T")) {
        t.setHours(23, 59, 59, 999);
      }
      toTimestamp = t;
    }
  }

  // 1. Truy vấn PostgreSQL
  if (pool && typeof pool.query === "function") {
    try {
      const queryParams = [];
      let paramIdx = 1;

      // Xây dựng điều kiện lọc theo tổ chức sở hữu lô hàng (Tenant Isolation T-12)
      let tenantClause = "";
      if (effectiveTenantFilter) {
        tenantClause = `
          AND EXISTS (
            SELECT 1 
            FROM shipment_lots sl_inner
            JOIN lots l_inner ON sl_inner.lot_id = l_inner.id
            WHERE sl_inner.shipment_id = s.id 
              AND l_inner.organization_id = $${paramIdx++}
          )
        `;
        queryParams.push(effectiveTenantFilter);
      }

      // Xây dựng điều kiện thời gian
      let dateClause = "";
      if (fromTimestamp) {
        dateClause += ` AND s.started_at >= $${paramIdx++}`;
        queryParams.push(fromTimestamp);
      }
      if (toTimestamp) {
        dateClause += ` AND s.started_at <= $${paramIdx++}`;
        queryParams.push(toTimestamp);
      }

      // Lấy danh sách chuyến vận chuyển thoả mãn điều kiện
      const sql = `
        SELECT 
          s.id AS shipment_id,
          s.organization_id AS transporter_id,
          COALESCE(o.name, s.organization_id) AS transporter_name,
          s.started_at,
          s.status,
          COALESCE(v.violation_count, 0)::int AS violation_count,
          COALESCE(v.total_violation_minutes, 0)::float AS total_violation_minutes
        FROM shipments s
        LEFT JOIN organizations o ON s.organization_id = o.id
        LEFT JOIN (
          SELECT 
            shipment_id,
            COUNT(id) AS violation_count,
            SUM(duration_minutes) AS total_violation_minutes
          FROM temperature_violations
          GROUP BY shipment_id
        ) v ON s.id = v.shipment_id
        WHERE 1=1
          ${tenantClause}
          ${dateClause}
        ORDER BY s.organization_id ASC, s.started_at ASC
      `;

      const dbRes = await pool.query(sql, queryParams);
      return formatAggregationResults(dbRes.rows, {
        fromDate: fromDate || null,
        toDate: toDate || null,
        filteredOrgId: effectiveTenantFilter,
      });
    } catch (dbErr) {
      console.error("[getTransporterViolationReport DB Error, falling back to memory]:", dbErr.message);
    }
  }

  // 2. Chế độ in-memory fallback
  const shipments = inMemoryShipmentsList || inMemoryShipments;
  const shipmentLots = inMemoryShipmentLotsList || inMemoryShipmentLots;
  const violations = inMemoryViolationsList || inMemoryViolations;
  const lots = inMemoryLotsList || [];

  // Xác định các chuyến hợp lệ theo Tenant Isolation
  let eligibleShipments = shipments.filter((s) => {
    // Lọc theo thời gian
    if (fromTimestamp && new Date(s.startedAt || s.createdAt) < fromTimestamp) return false;
    if (toTimestamp && new Date(s.startedAt || s.createdAt) > toTimestamp) return false;

    // Lọc theo tổ chức chủ sở hữu của lô hàng trên chuyến
    if (effectiveTenantFilter) {
      // Tìm các lô trên chuyến này
      const sId = s.id || s.shipmentId || s.shipment_id;
      const lotsOnShipment = shipmentLots.filter((sl) => (sl.shipmentId || sl.shipment_id) === sId);
      const hasMyLot = lotsOnShipment.some((sl) => {
        const targetLotId = sl.lotId || sl.lot_id;
        const lot = lots.find((l) => (l.id || l.code) === targetLotId);
        return lot && (lot.organizationId === effectiveTenantFilter || lot.organization_id === effectiveTenantFilter);
      });
      if (!hasMyLot) return false;
    }

    return true;
  });

  // Gắn số liệu vi phạm cho từng chuyến
  const rows = eligibleShipments.map((s) => {
    const sViolations = violations.filter((v) => v.shipmentId === s.id);
    const totalMinutes = sViolations.reduce((sum, v) => sum + Number(v.durationMinutes || v.duration_minutes || 0), 0);
    const tId = s.organizationId || s.organization_id || "UNASSIGNED";
    const tName = orgMap.get(tId) || s.organizationName || tId;

    return {
      shipment_id: s.id,
      transporter_id: tId,
      transporter_name: tName,
      started_at: s.startedAt || s.createdAt,
      status: s.status,
      violation_count: sViolations.length,
      total_violation_minutes: totalMinutes,
    };
  });

  return formatAggregationResults(rows, {
    fromDate: fromDate || null,
    toDate: toDate || null,
    filteredOrgId: effectiveTenantFilter,
  });
}

/**
 * Gom nhóm theo đơn vị vận chuyển và tính toán các chỉ số thống kê
 */
function formatAggregationResults(rows, metadata = {}) {
  const transporterGroups = new Map();

  for (const row of rows) {
    const tId = row.transporter_id || "UNKNOWN";
    const tName = row.transporter_name || tId;

    if (!transporterGroups.has(tId)) {
      transporterGroups.set(tId, {
        transporterId: tId,
        transporterName: tName,
        totalShipments: 0,
        safeShipments: 0,
        violatedShipments: 0,
        violationCount: 0,
        totalViolationMinutes: 0,
        violationRate: 0,
        riskLevel: "LOW",
      });
    }

    const group = transporterGroups.get(tId);
    group.totalShipments += 1;

    const vCount = Number(row.violation_count) || 0;
    const vMinutes = Number(row.total_violation_minutes) || 0;

    if (vCount > 0) {
      group.violatedShipments += 1;
      group.violationCount += vCount;
      group.totalViolationMinutes += vMinutes;
    } else {
      group.safeShipments += 1;
    }
  }

  // Tính tỉ lệ vi phạm và mức độ rủi ro cho từng đơn vị
  const transporters = Array.from(transporterGroups.values()).map((g) => {
    const rate = g.totalShipments > 0 ? (g.violatedShipments / g.totalShipments) * 100 : 0;
    const roundedRate = Number(rate.toFixed(1));

    let riskLevel = "LOW";
    if (roundedRate > 30 || g.totalViolationMinutes > 120) {
      riskLevel = "HIGH";
    } else if (roundedRate > 10 || g.totalViolationMinutes > 30) {
      riskLevel = "MEDIUM";
    }

    return {
      transporterId: g.transporterId,
      transporterName: g.transporterName,
      totalShipments: g.totalShipments,
      safeShipments: g.safeShipments,
      violatedShipments: g.violatedShipments,
      violationCount: g.violationCount,
      totalViolationMinutes: Number(g.totalViolationMinutes.toFixed(1)),
      violationRate: roundedRate,
      riskLevel,
    };
  });

  // Sắp xếp đơn vị có tỉ lệ vi phạm cao nhất lên đầu để cảnh báo
  transporters.sort((a, b) => b.violationRate - a.violationRate || b.totalViolationMinutes - a.totalViolationMinutes);

  // Tính tổng thể toàn bộ hệ thống
  const totalShipmentsOverall = transporters.reduce((acc, t) => acc + t.totalShipments, 0);
  const totalViolatedOverall = transporters.reduce((acc, t) => acc + t.violatedShipments, 0);
  const totalViolationsOverall = transporters.reduce((acc, t) => acc + t.violationCount, 0);
  const totalMinutesOverall = transporters.reduce((acc, t) => acc + t.totalViolationMinutes, 0);
  const overallRate = totalShipmentsOverall > 0 ? (totalViolatedOverall / totalShipmentsOverall) * 100 : 0;

  return {
    status: 200,
    period: {
      fromDate: metadata.fromDate,
      toDate: metadata.toDate,
    },
    filteredOrgId: metadata.filteredOrgId,
    summary: {
      totalTransporters: transporters.length,
      totalShipments: totalShipmentsOverall,
      safeShipments: totalShipmentsOverall - totalViolatedOverall,
      violatedShipments: totalViolatedOverall,
      totalViolations: totalViolationsOverall,
      totalViolationMinutes: Number(totalMinutesOverall.toFixed(1)),
      overallViolationRate: Number(overallRate.toFixed(1)),
    },
    transporters,
  };
}

module.exports = {
  getTransporterViolationReport,
  getOrganizationNameMap,
};
