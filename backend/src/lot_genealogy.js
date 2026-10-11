/**
 * Module duyệt phả hệ lô hàng toàn diện (Genealogy Traversal Engine)
 * Tích hợp:
 * - S-21 (T-49, T-50): Duyệt ngược tổ tiên đa tầng (traceLotOrigins)
 * - S-26 (Bước 1 - Bước 5): Duyệt xuôi hậu duệ tách/gộp đa tầng (traceLotDescendants)
 * - Diamond DAG & Cycle Detection (CycleDetectedError)
 */

/**
 * Lớp lỗi tùy chỉnh phát hiện chu trình phả hệ (CycleDetectedError)
 * Tương thích cả S-21 (truy ngược tổ tiên) và S-26 (truy xuôi hậu duệ).
 */
class CycleDetectedError extends Error {
  constructor(cycleLotId, path = [], customMessage = null) {
    const msg = customMessage || (path && path.length
      ? `Phát hiện chu trình phả hệ tại lô ${cycleLotId}. Dữ liệu quan hệ cha-con bị lặp vòng.`
      : `Phát hiện chu trình cha–con tại lô ${cycleLotId}. Dữ liệu quan hệ cha-con bị lặp vòng.`);
    super(msg);
    this.name = "CycleDetectedError";
    this.cycleLotId = cycleLotId;
    this.path = path;
    this.statusCode = 422;
  }
}


/**
 * Module duyệt phả hệ lô hàng (Genealogy Traversal) - Triển khai T-49 (S-22).
 * Thuật toán duyệt ngược BFS phân tầng & phát hiện chu trình (Non-recursive iterative queue).
 */


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



const { getBatchEvents } = require("./event_repository");
const { getOrganizationMap, fetchAllLotsRaw } = require("./lot_access");

/**
 * Lớp lỗi tùy chỉnh phát hiện chu trình phả hệ (CycleDetectedError)
 */

/**
 * Trích xuất danh sách child lot IDs từ danh sách sự kiện của một lô
 */
function extractChildLotIdsFromEvents(events = []) {
  const targetIds = [];
  for (const ev of events) {
    const p = (ev && ev.payload) || {};
    if (p.targetLotId) targetIds.push(p.targetLotId);
    if (p.childLotId) targetIds.push(p.childLotId);
    if (Array.isArray(p.childLotIds)) targetIds.push(...p.childLotIds);
  }
  return targetIds.filter(Boolean);
}

/**
 * Thuật toán duyệt xuôi hậu duệ tách/gộp nhiều tầng (traceLotDescendants)
 * Sử dụng BFS lặp (Iterative Queue theo tầng - Level-by-level BFS)
 * 
 * Vấn đề 1: Đồ thị kim cương (Diamond DAG - Khử lặp an toàn):
 * Dùng tập globalVisited để đảm bảo mỗi lô chỉ đưa vào danh sách hậu duệ duy nhất một lần,
 * nhưng ghi nhận đầy đủ cả 2 cạnh liên kết (B -> D và C -> D) trong edges của đồ thị.
 * 
 * Vấn đề 2: Dữ liệu chứa chu trình (Cycle Detection):
 * Mỗi phần tử trong queue mang theo mảng path. Nếu childId nằm trong path của nút cha hiện tại,
 * dừng duyệt và ném lỗi CycleDetectedError(childId).
 * 
 * @param {Object} options
 * @param {Object|null} options.pool - PostgreSQL pool kết nối CSDL (hoặc null nếu in-memory)
 * @param {string} options.startLotId - Mã lô gốc cần bắt đầu truy vết xuôi
 * @param {Array} [options.inMemoryLots] - Danh sách lô hàng in-memory
 * @param {Array} [options.inMemoryBatchRelations] - Danh sách quan hệ phân tách/gộp in-memory
 * @param {Array} [options.inMemoryBatchEvents] - Danh sách sự kiện in-memory (tùy chọn)
 * @param {Array} [options.inMemoryOrgs] - Danh sách tổ chức in-memory
 * @param {Array} [options.inMemoryProducts] - Danh sách sản phẩm in-memory
 * @param {Array} [options.inMemoryFarms] - Danh sách thửa đất/vùng trồng in-memory
 * @param {number} [options.maxDepth] - Độ sâu tối đa khi duyệt
 * @returns {Promise<Object>} Kết quả truy vết hậu duệ
 */
async function traceLotDescendants({
  pool = null,
  startLotId,
  inMemoryLots = [],
  inMemoryBatchRelations = [],
  inMemoryBatchEvents = [],
  inMemoryOrgs = [],
  inMemoryProducts = [],
  inMemoryFarms = [],
  maxDepth = 50,
}) {
  if (!startLotId) {
    return {
      rootLotId: null,
      descendantIds: [],
      descendants: [],
      levels: [],
      graph: { nodes: [], edges: [] },
    };
  }

  // 1. Tải bản đồ tổ chức, sản phẩm, trang trại và tất cả các lô
  const orgMap = await getOrganizationMap(pool, inMemoryOrgs);

  const prodMap = new Map();
  if (Array.isArray(inMemoryProducts)) {
    for (const p of inMemoryProducts) {
      if (p && p.id) prodMap.set(p.id, p);
    }
  }

  const farmMap = new Map();
  if (Array.isArray(inMemoryFarms)) {
    for (const f of inMemoryFarms) {
      if (f && f.id) farmMap.set(f.id, f);
    }
  }

  if (pool && typeof pool.query === "function") {
    try {
      const prodRes = await pool.query("SELECT id, name, unit FROM products");
      for (const r of prodRes.rows) {
        prodMap.set(r.id, { id: r.id, name: r.name, unit: r.unit });
      }
    } catch {
      // ignore
    }
    try {
      const farmRes = await pool.query("SELECT id, name, area, coordinates, organization_id FROM farms");
      for (const r of farmRes.rows) {
        farmMap.set(r.id, {
          id: r.id,
          name: r.name,
          area: r.area,
          coordinates: r.coordinates,
          organizationId: r.organization_id || r.organizationId,
        });
      }
    } catch {
      // ignore
    }
  }

  const allLots = await fetchAllLotsRaw(pool, inMemoryLots);
  const lotsMap = new Map();
  for (const l of allLots) {
    lotsMap.set(l.id, l);
  }

  const rootLot = lotsMap.get(startLotId) || null;

  // 2. Chuẩn bị BFS duyệt theo tầng
  let currentLevelQueue = [{ lotId: startLotId, path: [startLotId] }];
  const globalVisited = new Set([startLotId]);

  const levels = [];
  const allDescendantsList = [];
  const graphEdges = [];
  const edgeKeySet = new Set();

  let distance = 0;

  while (currentLevelQueue.length > 0 && distance < maxDepth) {
    distance += 1;
    const parentIdsInLevel = currentLevelQueue.map((item) => item.lotId);

    // Thu thập các quan hệ con từ parentIdsInLevel
    const rawRelationsFromParents = [];

    // A. Lấy từ batch_relations (Database / In-memory)
    if (pool && typeof pool.query === "function") {
      try {
        const brRes = await pool.query(
          `SELECT parent_batch_id, child_batch_id, relation_type, quantity, organization_id, created_at 
           FROM batch_relations 
           WHERE parent_batch_id = ANY($1::text[])`,
          [parentIdsInLevel]
        );
        for (const row of brRes.rows) {
          rawRelationsFromParents.push({
            parentBatchId: row.parent_batch_id,
            childBatchId: row.child_batch_id,
            relationType: row.relation_type || "SPLIT",
            quantity: row.quantity !== null && row.quantity !== undefined ? Number(row.quantity) : null,
          });
        }
      } catch {
        // ignore if table not present
      }
    }

    if (Array.isArray(inMemoryBatchRelations)) {
      for (const rel of inMemoryBatchRelations) {
        const pId = rel.parentBatchId || rel.parent_batch_id;
        const cId = rel.childBatchId || rel.child_batch_id;
        if (pId && cId && parentIdsInLevel.includes(pId)) {
          rawRelationsFromParents.push({
            parentBatchId: pId,
            childBatchId: cId,
            relationType: rel.relationType || rel.relation_type || "SPLIT",
            quantity: rel.quantity !== null && rel.quantity !== undefined ? Number(rel.quantity) : null,
          });
        }
      }
    }

    // B. Lấy từ quan hệ lots.parent_lot_id (Database / In-memory)
    if (pool && typeof pool.query === "function") {
      try {
        const lotChildRes = await pool.query(
          `SELECT id, parent_lot_id, initial_quantity 
           FROM lots 
           WHERE parent_lot_id = ANY($1::text[])`,
          [parentIdsInLevel]
        );
        for (const row of lotChildRes.rows) {
          const alreadyInRel = rawRelationsFromParents.some(
            (r) => r.parentBatchId === row.parent_lot_id && r.childBatchId === row.id
          );
          if (!alreadyInRel) {
            rawRelationsFromParents.push({
              parentBatchId: row.parent_lot_id,
              childBatchId: row.id,
              relationType: "SPLIT",
              quantity: row.initial_quantity !== null && row.initial_quantity !== undefined ? Number(row.initial_quantity) : null,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    for (const [id, lot] of lotsMap.entries()) {
      const pId = lot.parentLotId || lot.parent_lot_id;
      if (pId && parentIdsInLevel.includes(pId)) {
        const alreadyInRel = rawRelationsFromParents.some(
          (r) => r.parentBatchId === pId && r.childBatchId === id
        );
        if (!alreadyInRel) {
          const initQty = lot.initialQuantity !== undefined ? lot.initialQuantity : lot.initial_quantity;
          rawRelationsFromParents.push({
            parentBatchId: pId,
            childBatchId: id,
            relationType: "SPLIT",
            quantity: initQty !== null && initQty !== undefined ? Number(initQty) : null,
          });
        }
      }
    }

    // C. Hỗ trợ quan hệ từ Event Logs nếu có
    for (const pId of parentIdsInLevel) {
      let events = [];
      try {
        events = await getBatchEvents(pool, pId);
      } catch {
        events = [];
      }
      const childIdsFromEvents = extractChildLotIdsFromEvents(events);
      for (const cId of childIdsFromEvents) {
        const alreadyInRel = rawRelationsFromParents.some(
          (r) => r.parentBatchId === pId && r.childBatchId === cId
        );
        if (!alreadyInRel) {
          rawRelationsFromParents.push({
            parentBatchId: pId,
            childBatchId: cId,
            relationType: "SPLIT",
            quantity: null,
          });
        }
      }
    }

    // Duyệt từng node cha trong hàng đợi tầng hiện tại để kiểm tra chu trình và mở rộng cạnh
    const nextLevelQueue = [];
    const levelLots = [];

    for (const currentQueueItem of currentLevelQueue) {
      const parentId = currentQueueItem.lotId;
      const currentPath = currentQueueItem.path;

      // Lọc các quan hệ xuất phát từ node cha này
      const outgoingRels = rawRelationsFromParents.filter((r) => r.parentBatchId === parentId);

      for (const rel of outgoingRels) {
        const childId = rel.childBatchId;

        // Vấn đề 2: Kiểm tra Chu trình (Cycle Detection)
        // Nếu nút con chuẩn bị duyệt đã nằm trong path của nút hiện tại -> ném CycleDetectedError
        if (currentPath.includes(childId)) {
          throw new CycleDetectedError(childId, [...currentPath, childId]);
        }

        // Vấn đề 1: Đồ thị kim cương (Ghi nhận đầy đủ tất cả các cạnh vào graph.edges)
        const edgeKey = `${rel.parentBatchId}->${rel.childBatchId}`;
        if (!edgeKeySet.has(edgeKey)) {
          edgeKeySet.add(edgeKey);
          graphEdges.push({
            source: rel.parentBatchId,
            target: rel.childBatchId,
            relationType: rel.relationType,
            quantity: rel.quantity,
          });
        }

        // Khử lặp an toàn với globalVisited:
        // Nếu nút con này đã được thêm vào hậu duệ ở một nhánh/đường đi khác, không thêm lặp lại vào danh sách hậu duệ hay queue
        if (globalVisited.has(childId)) {
          continue;
        }

        globalVisited.add(childId);
        const newPath = [...currentPath, childId];

        nextLevelQueue.push({
          lotId: childId,
          path: newPath,
        });

        // Lấy chi tiết lô con
        const lotObj = lotsMap.get(childId) || null;
        const farmId = lotObj ? (lotObj.farmId || lotObj.farm_id || null) : null;
        const productId = lotObj ? (lotObj.productId || lotObj.product_id || null) : null;
        const orgId = lotObj ? (lotObj.organizationId || lotObj.organization_id || null) : null;

        const farmObj = farmId ? farmMap.get(farmId) : null;
        const prodObj = productId ? prodMap.get(productId) : null;

        const initQty = lotObj ? (lotObj.initialQuantity !== undefined ? lotObj.initialQuantity : lotObj.initial_quantity) : null;
        const remQty = lotObj ? (lotObj.remainingQuantity !== undefined ? lotObj.remainingQuantity : lotObj.remaining_quantity) : null;

        const descendantInfo = {
          id: childId,
          code: childId,
          name: lotObj ? lotObj.name : childId,
          status: lotObj ? lotObj.status : "Đã thu hoạch",
          organizationId: orgId,
          organizationName: orgMap[orgId] || orgId || null,
          productId,
          productName: prodObj ? prodObj.name : (lotObj ? lotObj.productName : null),
          productUnit: prodObj ? prodObj.unit : (lotObj ? lotObj.productUnit || "kg" : "kg"),
          farmId,
          farmName: farmObj ? farmObj.name : (lotObj ? lotObj.farmName : null),
          farm: farmObj || (farmId ? { id: farmId, name: farmId } : null),
          initialQuantity: initQty !== null && initQty !== undefined ? Number(initQty) : null,
          remainingQuantity: remQty !== null && remQty !== undefined ? Number(remQty) : null,
          relationType: rel.relationType || "SPLIT",
          quantity: rel.quantity !== null && rel.quantity !== undefined ? Number(rel.quantity) : null,
          distance,
          path: newPath,
          parentLotId: parentId,
          harvestedAt: lotObj ? (lotObj.harvestedAt || lotObj.harvested_at || null) : null,
          createdAt: lotObj ? (lotObj.createdAt || lotObj.created_at || null) : null,
        };

        levelLots.push(descendantInfo);
        allDescendantsList.push(descendantInfo);
      }
    }

    if (levelLots.length > 0) {
      levels.push({
        distance,
        label: distance === 1 ? "Tầng 1 (Lô con trực tiếp)" : distance === 2 ? "Tầng 2 (Lô cháu)" : `Tầng ${distance} (Hậu duệ xa)`,
        count: levelLots.length,
        lots: levelLots,
      });
    }

    currentLevelQueue = nextLevelQueue;
  }

  // 3. Xây dựng đồ thị Nodes & Edges
  const allNodeIds = Array.from(globalVisited);
  const graphNodes = allNodeIds.map((id) => {
    const l = lotsMap.get(id);
    const isRoot = id === startLotId;
    const descInfo = allDescendantsList.find((d) => d.id === id);
    return {
      id,
      name: l ? l.name : id,
      status: l ? l.status : "Đã thu hoạch",
      isCurrent: isRoot,
      isRoot,
      isDescendant: !isRoot,
      distance: descInfo ? descInfo.distance : 0,
      organizationId: l ? (l.organizationId || l.organization_id) : null,
      organizationName: l ? orgMap[l.organizationId || l.organization_id] : null,
      remainingQuantity: l ? (l.remainingQuantity !== undefined ? Number(l.remainingQuantity) : Number(l.remaining_quantity)) : null,
    };
  });

  return {
    rootLotId: startLotId,
    rootLot: rootLot
      ? {
          id: rootLot.id,
          name: rootLot.name,
          status: rootLot.status,
          organizationId: rootLot.organizationId || rootLot.organization_id,
          organizationName: orgMap[rootLot.organizationId || rootLot.organization_id],
          initialQuantity: rootLot.initialQuantity !== undefined ? Number(rootLot.initialQuantity) : Number(rootLot.initial_quantity),
          remainingQuantity: rootLot.remainingQuantity !== undefined ? Number(rootLot.remainingQuantity) : Number(rootLot.remaining_quantity),
        }
      : null,
    descendantCount: allDescendantsList.length,
    descendantIds: allDescendantsList.map((d) => d.id),
    descendants: allDescendantsList,
    levels,
    maxDistance: levels.length,
    graph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
  };
}



module.exports = {
  CycleDetectedError,
  traceLotOrigins,
  traceLotDescendants,
};
