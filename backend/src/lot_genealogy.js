/**
 * Module duyệt phả hệ lô hàng (Genealogy Traversal) - Triển khai T-49 (S-22).
 * Thuật toán duyệt ngược BFS phân tầng & phát hiện chu trình (Non-recursive iterative queue).
 */

class CycleDetectedError extends Error {
  constructor(cycleLotId) {
    super(`Phát hiện chu trình cha–con tại lô ${cycleLotId}`);
    this.name = "CycleDetectedError";
    this.cycleLotId = cycleLotId;
  }
}

/**
 * Trích xuất quan hệ cha từ batch_relations và parent_lot_id trong môi trường in-memory.
 */
function getParentsInMemory(currentLotId, lotsMap, relations) {
  const parents = [];
  const seenParentIds = new Set();

  // 1. Từ batch_relations (SPLIT / MERGE)
  for (const rel of relations) {
    const childId = rel.childBatchId || rel.child_batch_id;
    const parentId = rel.parentBatchId || rel.parent_batch_id;
    if (childId === currentLotId && parentId && !seenParentIds.has(parentId)) {
      seenParentIds.add(parentId);
      parents.push({
        parentId,
        relationType: rel.relationType || rel.relation_type || "MERGE",
        quantity: Number(rel.quantity || 0),
      });
    }
  }

  // 2. Từ lots.parent_lot_id
  const currentLot = lotsMap.get(currentLotId);
  const directParentId = currentLot ? (currentLot.parentLotId || currentLot.parent_lot_id) : null;
  if (directParentId && !seenParentIds.has(directParentId)) {
    seenParentIds.add(directParentId);
    parents.push({
      parentId: directParentId,
      relationType: "SPLIT",
      quantity: Number(currentLot.initialQuantity || currentLot.initial_quantity || 0),
    });
  }

  return parents;
}

/**
 * Truy vấn cha theo nhóm (batch query) từ PostgreSQL:
 * Kết hợp batch_relations WHERE child_batch_id = ANY($1) và lots.parent_lot_id của các con.
 */
async function getParentsFromDatabase(pool, childIds) {
  if (!childIds || childIds.length === 0) return new Map();

  const query = `
    SELECT 
      br.child_batch_id,
      br.parent_batch_id,
      br.relation_type,
      br.quantity
    FROM batch_relations br
    WHERE br.child_batch_id = ANY($1)
    UNION
    SELECT 
      l.id AS child_batch_id,
      l.parent_lot_id AS parent_batch_id,
      'SPLIT' AS relation_type,
      l.initial_quantity AS quantity
    FROM lots l
    WHERE l.id = ANY($1) AND l.parent_lot_id IS NOT NULL
  `;

  const res = await pool.query(query, [childIds]);
  const parentMap = new Map();
  for (const cid of childIds) {
    parentMap.set(cid, []);
  }

  const seenPerChild = new Map();
  for (const row of res.rows) {
    const cid = row.child_batch_id;
    const pid = row.parent_batch_id;
    if (!pid) continue;

    if (!seenPerChild.has(cid)) seenPerChild.set(cid, new Set());
    const seenSet = seenPerChild.get(cid);

    if (!seenSet.has(pid)) {
      seenSet.add(pid);
      if (!parentMap.has(cid)) parentMap.set(cid, []);
      parentMap.get(cid).push({
        parentId: pid,
        relationType: row.relation_type || "SPLIT",
        quantity: Number(row.quantity || 0),
      });
    }
  }

  return parentMap;
}

/**
 * Lấy thông tin chi tiết các lô hàng và vùng trồng (farms).
 */
async function fetchLotDetails(pool, lotIds, inMemoryData = {}) {
  const result = new Map();
  if (!lotIds || lotIds.length === 0) return result;

  if (pool && typeof pool.query === "function") {
    const query = `
      SELECT 
        l.id, l.name, l.status, l.organization_id, l.farm_id, l.product_id,
        l.initial_quantity, l.remaining_quantity, l.harvested_at, l.parent_lot_id, l.created_at,
        f.name AS farm_name, f.area AS farm_area, f.coordinates AS farm_coordinates,
        p.name AS product_name, p.unit AS product_unit,
        o.name AS organization_name
      FROM lots l
      LEFT JOIN farms f ON l.farm_id = f.id
      LEFT JOIN products p ON l.product_id = p.id
      LEFT JOIN organizations o ON l.organization_id = o.id
      WHERE l.id = ANY($1)
    `;
    const res = await pool.query(query, [lotIds]);
    for (const row of res.rows) {
      result.set(row.id, {
        id: row.id,
        name: row.name,
        status: row.status,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        farmId: row.farm_id,
        productId: row.product_id,
        productName: row.product_name,
        productUnit: row.product_unit,
        initialQuantity: Number(row.initial_quantity || 0),
        remainingQuantity: Number(row.remaining_quantity || 0),
        harvestedAt: row.harvested_at,
        parentLotId: row.parent_lot_id,
        createdAt: row.created_at,
        farm: row.farm_id ? {
          id: row.farm_id,
          name: row.farm_name,
          farm_name: row.farm_name,
          area: row.farm_area !== null ? Number(row.farm_area) : null,
          coordinates: row.farm_coordinates,
        } : null,
      });
    }
    return result;
  }

  // In-memory fallback
  const lots = inMemoryData.inMemoryLots || [];
  const farms = inMemoryData.inMemoryFarms || [];

  const farmMap = new Map();
  for (const f of farms) {
    farmMap.set(f.id, f);
  }

  for (const l of lots) {
    if (lotIds.includes(l.id)) {
      const f = l.farmId || l.farm_id ? farmMap.get(l.farmId || l.farm_id) : null;
      result.set(l.id, {
        id: l.id,
        name: l.name,
        status: l.status,
        organizationId: l.organizationId || l.organization_id,
        farmId: l.farmId || l.farm_id || null,
        productId: l.productId || l.product_id || null,
        initialQuantity: Number(l.initialQuantity || l.initial_quantity || 0),
        remainingQuantity: Number(l.remainingQuantity || l.remaining_quantity || 0),
        harvestedAt: l.harvestedAt || l.harvested_at,
        parentLotId: l.parentLotId || l.parent_lot_id || null,
        createdAt: l.createdAt || l.created_at,
        farm: f ? {
          id: f.id,
          name: f.name,
          farm_name: f.name,
          area: f.area !== null && f.area !== undefined ? Number(f.area) : null,
          coordinates: f.coordinates,
        } : null,
      });
    }
  }

  return result;
}

/**
 * traceLotOrigins: Hàm lõi duyệt đồ thị phả hệ ngược từ con lên cha, phân tầng và phát hiện chu trình (T-49).
 *
 * @param {object|null} pool - PostgreSQL pool hoặc client (null nếu chạy in-memory)
 * @param {string} lotId - ID của lô hàng bắt đầu truy vết
 * @param {object} options - Dữ liệu in-memory fallback { inMemoryLots, inMemoryBatchRelations, inMemoryFarms }
 * @returns {Promise<{
 *   lotId: string,
 *   isRoot: boolean,
 *   rootLots: Array<object>,
 *   levels: Array<{ level: number, lots: Array<object> }>,
 *   allAncestors: Array<object>,
 *   ancestorIds: Array<string>,
 *   totalAncestors: number
 * }>}
 */
async function traceLotOrigins(pool, lotId, options = {}) {
  const {
    inMemoryLots = [],
    inMemoryBatchRelations = [],
    inMemoryFarms = [],
  } = options;

  const inMemoryLotsMap = new Map();
  for (const l of inMemoryLots) {
    inMemoryLotsMap.set(l.id, l);
  }

  // 1. Kiểm tra lô xuất phát có tồn tại không
  const initialDetails = await fetchLotDetails(pool, [lotId], {
    inMemoryLots,
    inMemoryFarms,
  });
  const startLot = initialDetails.get(lotId);
  if (!startLot) {
    const notFoundError = new Error(`Không tìm thấy lô hàng ${lotId}`);
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  // 2. Thuật toán BFS lặp duyệt ngược con -> cha theo tầng (Non-recursive queue)
  // Mỗi phần tử trong currentLevelQueue: { lotId, path: [lotId, ...] }
  let currentLevelQueue = [{ lotId, path: [lotId] }];
  const globalVisited = new Set([lotId]);

  const levels = [];
  const rootLotsMap = new Map();
  const allAncestorsMap = new Map();

  let levelIndex = 1;

  while (currentLevelQueue.length > 0) {
    const nextLevelQueue = [];
    const childIdsInLevel = currentLevelQueue.map((item) => item.lotId);

    // Truy vấn cha theo nhóm (batch query) cho toàn bộ tầng hiện tại
    let parentsByChildMap;
    if (pool && typeof pool.query === "function") {
      parentsByChildMap = await getParentsFromDatabase(pool, childIdsInLevel);
    } else {
      parentsByChildMap = new Map();
      for (const cid of childIdsInLevel) {
        parentsByChildMap.set(
          cid,
          getParentsInMemory(cid, inMemoryLotsMap, inMemoryBatchRelations)
        );
      }
    }

    // Tập hợp các cha ở tầng kế tiếp
    const levelLotsMap = new Map();

    for (const item of currentLevelQueue) {
      const currentId = item.lotId;
      const currentPath = item.path; // Đường đi tổ tiên dẫn đến currentId
      const parents = parentsByChildMap.get(currentId) || [];

      // Nhận diện lô gốc (Root Lot): không có cha nào trong batch_relations và không có parent_lot_id
      if (parents.length === 0) {
        // Nếu chính lô bắt đầu duyệt không có cha -> nó là lô gốc (F0)
        if (currentId === lotId) {
          rootLotsMap.set(currentId, startLot);
        } else {
          // Là một lô gốc tổ tiên
          rootLotsMap.set(currentId, allAncestorsMap.get(currentId) || { id: currentId });
        }
        continue;
      }

      for (const p of parents) {
        const parentId = p.parentId;

        // Phát hiện chu trình (Cycle Detection - AC4 / T-49):
        // Nếu nút cha xuất hiện trên nhánh đường đi hiện tại của nó (currentPath), dừng ngay và ném lỗi rõ ràng
        if (currentPath.includes(parentId)) {
          throw new CycleDetectedError(parentId);
        }

        if (!levelLotsMap.has(parentId)) {
          levelLotsMap.set(parentId, {
            id: parentId,
            relationType: p.relationType,
            quantity: p.quantity,
            childLotId: currentId,
          });
        }

        // Nếu cha chưa từng được xếp vào hàng đợi tầng kế tiếp trên toàn cục
        if (!globalVisited.has(parentId)) {
          globalVisited.add(parentId);
          nextLevelQueue.push({
            lotId: parentId,
            path: [...currentPath, parentId],
          });
        }
      }
    }

    // Nếu tầng hiện tại tìm được các nút cha
    if (levelLotsMap.size > 0) {
      const parentIdsToFetch = Array.from(levelLotsMap.keys());
      const parentDetails = await fetchLotDetails(pool, parentIdsToFetch, {
        inMemoryLots,
        inMemoryFarms,
      });

      const lotsInLevel = [];
      for (const pid of parentIdsToFetch) {
        const detail = parentDetails.get(pid) || { id: pid };
        const meta = levelLotsMap.get(pid);
        const lotObj = {
          ...detail,
          relationType: meta.relationType,
          quantity: meta.quantity,
          childLotId: meta.childLotId,
          level: levelIndex,
        };
        lotsInLevel.push(lotObj);
        allAncestorsMap.set(pid, lotObj);
      }

      levels.push({
        level: levelIndex,
        lots: lotsInLevel,
      });

      levelIndex++;
    }

    currentLevelQueue = nextLevelQueue;
  }

  // Cập nhật lại chi tiết đầy đủ cho rootLots
  const rootLotIds = Array.from(rootLotsMap.keys());
  const rootDetails = await fetchLotDetails(pool, rootLotIds, {
    inMemoryLots,
    inMemoryFarms,
  });

  const rootLots = rootLotIds.map((rid) => {
    const detail = rootDetails.get(rid) || rootLotsMap.get(rid) || { id: rid };
    return {
      ...detail,
      isRoot: true,
    };
  });

  // AC3: Nếu lô chưa từng tách/gộp (F0): trả về chính nó là lô gốc duy nhất
  const isRoot = rootLots.length === 1 && rootLots[0].id === lotId;

  return {
    lotId,
    startLot,
    isRoot,
    rootLots,
    levels,
    allAncestors: Array.from(allAncestorsMap.values()),
    ancestorIds: Array.from(allAncestorsMap.keys()),
    totalAncestors: allAncestorsMap.size,
  };
}

module.exports = {
  CycleDetectedError,
  traceLotOrigins,
};
