/**
 * Module quản lý và xử lý Lệnh thu hồi (Recall Orders Service)
 * Story S-33 & S-34:
 * - Truy xuất thông tin lệnh thu hồi
 * - Tính toán động danh sách lô hậu duệ tại thời điểm xem (Real-time BFS Traversal)
 * - Xử lý gắn cờ lô gộp đa nguồn (isMultiSourceMerge)
 * - Phân loại tồn kho cần thu hồi và các lô đã tiêu thụ tới người dùng cuối
 */

const { traceLotDescendants } = require("./lot_genealogy");

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

module.exports = {
  getRecallOrderWithLiveDescendants,
};
