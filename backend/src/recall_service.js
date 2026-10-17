/**
 * Module quản lý và xử lý Lệnh thu hồi (Recall Orders Service)
 * Story S-33 & S-34:
 * - Truy xuất thông tin lệnh thu hồi
 * - Tính toán động danh sách lô hậu duệ tại thời điểm xem (Real-time BFS Traversal)
 * - Xử lý gắn cờ lô gộp đa nguồn (isMultiSourceMerge)
 * - Phân loại tồn kho cần thu hồi và các lô đã tiêu thụ tới người dùng cuối
 */

const { traceLotDescendants } = require("./lot_genealogy");
const { scopedQueryById } = require("./query");

/**
 * Lấy chi tiết lệnh thu hồi kèm danh sách hậu duệ tính toán theo thời gian thực (Live BFS)
 * @param {Object} options
 * @param {string} options.recallOrderId - Mã lệnh thu hồi
 * @param {Object} [options.pool] - PostgreSQL pool
 * @param {Array} [options.inMemoryRecallOrders] - Danh sách lệnh thu hồi in-memory
 * @param {Array} [options.inMemoryLots] - Danh sách lô in-memory
 * @param {Array} [options.inMemoryBatchRelations] - Quan hệ tách/gộp in-memory
 * @param {Array} [options.inMemoryBatchEvents] - Sự kiện in-memory
 * @param {Array} [options.inMemoryOrgs] - Tổ chức in-memory
 * @param {Array} [options.inMemoryProducts] - Sản phẩm in-memory
 * @param {Array} [options.inMemoryFarms] - Trang trại in-memory
 * @param {Array} [options.inMemoryLocations] - Địa điểm in-memory
 * @param {number} [options.maxDepth] - Độ sâu duyệt BFS tối đa (nếu có)
 * @returns {Promise<Object>}
 */
async function getRecallOrderWithLiveDescendants({
  recallOrderId,
  pool = null,
  inMemoryRecallOrders = [],
  inMemoryLots = [],
  inMemoryBatchRelations = [],
  inMemoryBatchEvents = [],
  inMemoryOrgs = [],
  inMemoryProducts = [],
  inMemoryFarms = [],
  inMemoryLocations = [],
  maxDepth = null,
}) {
  if (!recallOrderId) {
    throw new Error("recallOrderId là bắt buộc.");
  }

  // Bước 1: Đọc thông tin lệnh thu hồi từ recall_orders (lấy ra lot_id gốc)
  let order = null;
  if (pool && typeof pool.query === "function") {
    try {
      const res = await pool.query(
        `SELECT id, lot_id, reason, severity, status, created_by, created_at, updated_at
         FROM recall_orders
         WHERE id = $1`,
        [recallOrderId]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        order = {
          id: r.id,
          lotId: r.lot_id,
          reason: r.reason,
          severity: r.severity,
          status: r.status,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      }
    } catch (err) {
      if (err.code !== "42P01") {
        throw new Error(`Lỗi truy vấn recall_orders: ${err.message}`);
      }
    }
  }

  if (!order && Array.isArray(inMemoryRecallOrders)) {
    const found = inMemoryRecallOrders.find((o) => o.id === recallOrderId);
    if (found) {
      order = {
        id: found.id,
        lotId: found.lotId || found.lot_id,
        reason: found.reason,
        severity: found.severity || "HIGH",
        status: found.status || "OPEN",
        createdBy: found.createdBy || found.created_by,
        createdAt: found.createdAt || found.created_at || new Date().toISOString(),
        updatedAt: found.updatedAt || found.updated_at || new Date().toISOString(),
      };
    }
  }

  if (!order) {
    const notFoundErr = new Error(`Không tìm thấy lệnh thu hồi với mã ${recallOrderId}`);
    notFoundErr.statusCode = 404;
    throw notFoundErr;
  }

  // Bước 2: Gọi trực tiếp thuật toán duyệt đồ thị traceLotDescendants(lot_id) theo thời gian thực (Real-time BFS)
  const rootLotId = order.lotId;
  const genealogyResult = await traceLotDescendants({
    pool,
    startLotId: rootLotId,
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
    inMemoryOrgs,
    inMemoryProducts,
    inMemoryFarms,
    inMemoryLocations,
    maxDepth,
  });

  const allDescendants = genealogyResult.descendants || [];

  // Bước 3: Phân loại:
  // - Lô còn tồn kho cần thu hồi (remainingQuantity > 0)
  // - Lô đã tiêu thụ tới người dùng cuối (remainingQuantity == 0 và status == "Đã bán hết" theo S-29)
  const quarantineInventoryLots = [];
  const consumedLots = [];
  const otherLots = [];

  let totalQuarantineQuantity = 0;

  for (const d of allDescendants) {
    const remQty = Number(d.remainingQuantity || 0);
    const isConsumed = remQty === 0 && (d.status === "Đã bán hết" || d.status === "Đã tiêu thụ");

    if (isConsumed) {
      consumedLots.push(d);
    } else if (remQty > 0) {
      quarantineInventoryLots.push(d);
      totalQuarantineQuantity = Number((totalQuarantineQuantity + remQty).toFixed(3));
    } else {
      otherLots.push(d);
    }
  }

  return {
    recallOrder: order,
    rootLot: genealogyResult.rootLot,
    descendantCount: genealogyResult.descendantCount,
    descendantIds: genealogyResult.descendantIds,
    descendants: allDescendants,
    quarantineSummary: {
      totalDescendants: allDescendants.length,
      quarantineLotsCount: quarantineInventoryLots.length,
      totalQuarantineQuantity,
      consumedLotsCount: consumedLots.length,
    },
    quarantineInventoryLots,
    consumedLots,
    otherLots,
    locationSummary: genealogyResult.locationSummary || [],
    levels: genealogyResult.levels || [],
    graph: genealogyResult.graph || { nodes: [], edges: [] },
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Story S-38: Kiểm tra xem một lô hàng có bị chặn thao tác (Bàn giao, Tách, Gộp) do đang trong lệnh thu hồi hoặc đã hoàn tất thu hồi hay không
 * 
 * Nghiệp vụ S-38:
 * - Giả sử lô nằm trong lệnh thu hồi đang mở (OPEN / INVESTIGATING): Bị chặn kèm mã lệnh thu hồi.
 * - Giả sử lệnh đã hoàn tất (COMPLETED / hoặc lô có trạng thái 'Có sự cố'/'Đang thu hồi'/'Đã thu hồi'): Vẫn bị chặn vì lô đã được đánh dấu có sự cố.
 *
 * @param {Object} options
 * @param {string} options.lotId - Mã lô cần kiểm tra
 * @param {Object} [options.lot] - Đối tượng lô (nếu đã có sẵn thông tin status)
 * @param {Object} [options.pool] - PostgreSQL pool (nếu dùng CSDL)
 * @param {Array} [options.inMemoryRecallOrders] - Danh sách lệnh thu hồi in-memory
 * @param {Array} [options.inMemoryLots] - Danh sách lô in-memory
 * @returns {Promise<{ isBlocked: boolean, blockReason?: string, recallOrderId?: string|null, status?: string|null, message?: string }>}
 */
async function checkLotRecallStatus({
  lotId,
  lot = null,
  pool = null,
  inMemoryRecallOrders = [],
  inMemoryLots = [],
}) {
  if (!lotId) {
    return { isBlocked: false };
  }

  // 1. Kiểm tra lệnh thu hồi đang mở (OPEN hoặc INVESTIGATING)
  // Lệnh thu hồi có thể mở trực tiếp trên lô này, hoặc lô này là một trong các hậu duệ thuộc diện thu hồi
  let activeOrder = null;
  let completedOrder = null;

  if (pool && typeof pool.query === "function") {
    try {
      // 1.1 Tìm lệnh thu hồi trực tiếp gắn với lô này
      const directRes = await pool.query(
        `SELECT id, lot_id, status, reason
         FROM recall_orders
         WHERE lot_id = $1
         ORDER BY created_at DESC`,
        [lotId]
      );
      for (const r of directRes.rows) {
        if (r.status === "OPEN" || r.status === "INVESTIGATING") {
          activeOrder = { id: r.id, status: r.status, reason: r.reason, lotId: r.lot_id };
          break;
        } else if (r.status === "COMPLETED" && !completedOrder) {
          completedOrder = { id: r.id, status: r.status, reason: r.reason, lotId: r.lot_id };
        }
      }

      // 1.2 Nếu chưa tìm thấy activeOrder trực tiếp, kiểm tra các lệnh thu hồi đang mở khác xem lô này có phải là hậu duệ không
      if (!activeOrder) {
        const openOrdersRes = await pool.query(
          `SELECT id, lot_id, status, reason
           FROM recall_orders
           WHERE status IN ('OPEN', 'INVESTIGATING')
           ORDER BY created_at DESC`
        );
        for (const orderRow of openOrdersRes.rows) {
          // Duyệt hậu duệ của orderRow.lot_id
          const descResult = await traceLotDescendants({
            pool,
            startLotId: orderRow.lot_id,
          });
          if (descResult.descendantIds && descResult.descendantIds.includes(lotId)) {
            activeOrder = {
              id: orderRow.id,
              status: orderRow.status,
              reason: orderRow.reason,
              lotId: orderRow.lot_id,
              isDescendant: true,
            };
            break;
          }
        }
      }
    } catch (err) {
      if (err.code !== "42P01") {
        console.error("[checkLotRecallStatus] DB query error:", err.message);
      }
    }
  }

  // Fallback in-memory
  if (!activeOrder && Array.isArray(inMemoryRecallOrders)) {
    // Tìm lệnh trực tiếp
    for (const o of inMemoryRecallOrders) {
      const orderLotId = o.lotId || o.lot_id;
      if (orderLotId === lotId) {
        if (o.status === "OPEN" || o.status === "INVESTIGATING") {
          activeOrder = { id: o.id, status: o.status, reason: o.reason, lotId: orderLotId };
          break;
        } else if (o.status === "COMPLETED" && !completedOrder) {
          completedOrder = { id: o.id, status: o.status, reason: o.reason, lotId: orderLotId };
        }
      }
    }

    // Tìm nếu lô là hậu duệ của lệnh đang mở
    if (!activeOrder) {
      const openOrders = inMemoryRecallOrders.filter((o) => o.status === "OPEN" || o.status === "INVESTIGATING");
      for (const o of openOrders) {
        const rootId = o.lotId || o.lot_id;
        const descResult = await traceLotDescendants({
          startLotId: rootId,
          inMemoryLots,
        });
        if (descResult.descendantIds && descResult.descendantIds.includes(lotId)) {
          activeOrder = {
            id: o.id,
            status: o.status,
            reason: o.reason,
            lotId: rootId,
            isDescendant: true,
          };
          break;
        }
      }
    }
  }

  // Nếu lô nằm trong lệnh thu hồi đang mở
  if (activeOrder) {
    return {
      isBlocked: true,
      blockReason: "LOT_IN_ACTIVE_RECALL",
      recallOrderId: activeOrder.id,
      status: activeOrder.status,
      message: `Lô hàng đang trong lệnh thu hồi ${activeOrder.id} (${activeOrder.status}). Thao tác bị chặn.`,
    };
  }

  // 2. Lấy thông tin trạng thái của lô hàng
  let currentLot = lot;
  if (!currentLot) {
    if (pool && typeof pool.query === "function") {
      try {
        const lRes = await scopedQueryById(pool, null, "lots", lotId, { allowGlobal: true });
        if (lRes.row) currentLot = lRes.row;
      } catch (err) {
        if (err.code !== "42P01") {
          console.error("[checkLotRecallStatus] Lot query error:", err.message);
        }
      }
    }
    if (!currentLot && Array.isArray(inMemoryLots)) {
      currentLot = inMemoryLots.find((l) => l.id === lotId) || null;
    }
  }

  const lotStatus = currentLot ? (currentLot.status || "") : "";
  const isProblemStatus = lotStatus === "Có sự cố" || lotStatus === "Đang thu hồi" || lotStatus === "Đã thu hồi";

  // Giả sử lệnh đã hoàn tất hoặc lô đã được đánh dấu có sự cố
  if (completedOrder || isProblemStatus) {
    const recId = completedOrder ? completedOrder.id : null;
    return {
      isBlocked: true,
      blockReason: "LOT_RECALLED_OR_INCIDENT",
      recallOrderId: recId,
      status: completedOrder ? completedOrder.status : lotStatus,
      message: `Lô hàng đã được đánh dấu có sự cố${recId ? ` sau lệnh thu hồi ${recId}` : ""}. Thao tác bị chặn.`,
    };
  }

  return {
    isBlocked: false,
    recallOrderId: null,
    status: lotStatus,
  };
}

module.exports = {
  getRecallOrderWithLiveDescendants,
  checkLotRecallStatus,
};
