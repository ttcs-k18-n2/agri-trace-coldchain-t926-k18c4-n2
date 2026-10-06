const { getBatchEvents } = require("./event_repository");

const ORG_NAME_FALLBACKS = {
  "org-001": "Nông trại Xanh (Org 1)",
  "org-002": "HTX Chế biến Nông sản (Org 2)",
  "org-003": "Nhà phân phối Chuỗi Lạnh (Org 3)",
};

async function getOrganizationMap(pool, inMemoryOrgs = []) {
  const map = { ...ORG_NAME_FALLBACKS };
  if (Array.isArray(inMemoryOrgs)) {
    for (const o of inMemoryOrgs) {
      if (o && o.id && o.name) map[o.id] = o.name;
    }
  }
  if (pool && typeof pool.query === "function") {
    try {
      const res = await pool.query("SELECT id, name FROM organizations");
      for (const r of res.rows) {
        map[r.id] = r.name;
      }
    } catch {
      // ignore if table not ready
    }
  }
  return map;
}

function extractParentLotIdsFromEvent(ev) {
  const p = (ev && ev.payload) || {};
  const ids = [];
  if (p.parentLotId) ids.push(p.parentLotId);
  if (p.sourceLotId) ids.push(p.sourceLotId);
  if (p.fromLotId) ids.push(p.fromLotId);
  if (Array.isArray(p.parentLotIds)) ids.push(...p.parentLotIds);
  if (Array.isArray(p.sourceLotIds)) ids.push(...p.sourceLotIds);
  return ids.filter(Boolean);
}

function extractParentLotIdsFromLot(lot) {
  if (!lot) return [];
  const ids = [];
  const parentId = lot.parentLotId || lot.parent_lot_id || lot.sourceLotId || lot.source_lot_id;
  if (parentId) ids.push(parentId);
  if (Array.isArray(lot.parentLotIds)) ids.push(...lot.parentLotIds);
  if (Array.isArray(lot.sourceLotIds)) ids.push(...lot.sourceLotIds);
  return ids.filter(Boolean);
}

async function fetchAllLotsRaw(pool, inMemoryLots = []) {
  if (pool && typeof pool.query === "function") {
    const res = await pool.query("SELECT * FROM lots");
    return res.rows.map((r) => ({
      ...r,
      id: r.id,
      organizationId: r.organization_id || r.organizationId,
      parentLotId: r.parent_lot_id || r.parentLotId || null,
    }));
  }
  return inMemoryLots.map((l) => ({
    ...l,
    id: l.id,
    organizationId: l.organizationId || l.organization_id,
    parentLotId: l.parentLotId || l.parent_lot_id || null,
  }));
}

async function collectAncestorLotIds(pool, startLotId, lotsMap) {
  const visited = new Set();
  const queue = [startLotId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const lotObj = lotsMap.get(currentId);
    for (const pid of extractParentLotIdsFromLot(lotObj)) {
      if (!visited.has(pid)) queue.push(pid);
    }

    const events = await getBatchEvents(pool, currentId);
    for (const ev of events) {
      for (const pid of extractParentLotIdsFromEvent(ev)) {
        if (!visited.has(pid)) queue.push(pid);
      }
    }
  }

  visited.delete(startLotId);
  return visited;
}

function findCutoffSequenceForPastHolder(events, orgId) {
  let lastSeenIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const evOrg = ev.organizationId || ev.organization_id;
    const p = ev.payload || {};
    const fromOrg = p.fromOrganizationId || p.from_organization_id || p.senderOrganizationId;
    const toOrg = p.toOrganizationId || p.to_organization_id || p.receiverOrganizationId || p.targetOrganizationId;

    if (evOrg === orgId || fromOrg === orgId || toOrg === orgId) {
      lastSeenIndex = i;
    }
  }
  if (lastSeenIndex === -1) return null;
  return events[lastSeenIndex].sequenceNo;
}

/**
 * Quy tắc quyền tập trung cho S-23 (T-54):
 * Dùng chung cho chi tiết lô, dòng thời gian sự kiện và truy xuất nguồn gốc.
 */
async function evaluateLotAccess({ pool, authContext, lotId, inMemoryLots = [], inMemoryOrgs = [] }) {
  const isGlobal = Boolean(
    authContext &&
      (authContext.roleId === "inspector" ||
        authContext.isInspector ||
        authContext.roleId === "admin" ||
        authContext.isAdmin)
  );
  const orgId = authContext ? authContext.organizationId || authContext.organization_id : null;

  const allLots = await fetchAllLotsRaw(pool, inMemoryLots);
  const lotsMap = new Map(allLots.map((l) => [l.id, l]));
  const targetLot = lotsMap.get(lotId) || null;

  if (!targetLot) {
    return { status: "NOT_FOUND", allowed: false, lot: null, events: [], ancestors: [] };
  }

  const orgMap = await getOrganizationMap(pool, inMemoryOrgs);
  const enrichEvents = (evList) =>
    evList.map((e) => {
      const eOrg = e.organizationId || e.organization_id;
      return {
        ...e,
        organizationId: eOrg,
        organizationName: (e.payload && e.payload.organizationName) || orgMap[eOrg] || eOrg,
      };
    });

  const targetEvents = await getBatchEvents(pool, lotId);

  // 1. Admin / Inspector hoặc Tổ chức đang trực tiếp giữ lô hàng
  if (isGlobal || (orgId && targetLot.organizationId === orgId)) {
    const ancestorIds = await collectAncestorLotIds(pool, lotId, lotsMap);
    const ancestors = [];
    const ancestorEvents = [];

    for (const ancId of ancestorIds) {
      const ancLot = lotsMap.get(ancId);
      const ancEvs = enrichEvents(await getBatchEvents(pool, ancId));
      if (ancLot) {
        ancestors.push({
          ...ancLot,
          organizationName: orgMap[ancLot.organizationId] || ancLot.organizationId,
          events: ancEvs,
        });
      }
      ancestorEvents.push(...ancEvs);
    }

    return {
      status: "ALLOWED_FULL",
      allowed: true,
      accessType: "CURRENT_HOLDER",
      lot: {
        ...targetLot,
        organizationName: orgMap[targetLot.organizationId] || targetLot.organizationId,
      },
      events: enrichEvents(targetEvents),
      ancestorEvents,
      ancestors,
    };
  }

  // 2. Kiểm tra nếu targetLot là TỔ TIÊN của bất kỳ lô nào mà orgId đang giữ
  const myHeldLots = allLots.filter((l) => l.organizationId === orgId);
  for (const myLot of myHeldLots) {
    const myAncestors = await collectAncestorLotIds(pool, myLot.id, lotsMap);
    if (myAncestors.has(lotId)) {
      const ancestorIds = await collectAncestorLotIds(pool, lotId, lotsMap);
      const ancestors = [];
      for (const ancId of ancestorIds) {
        const ancLot = lotsMap.get(ancId);
        if (ancLot) {
          ancestors.push({
            ...ancLot,
            organizationName: orgMap[ancLot.organizationId] || ancLot.organizationId,
            events: enrichEvents(await getBatchEvents(pool, ancId)),
          });
        }
      }
      return {
        status: "ALLOWED_ANCESTOR",
        allowed: true,
        accessType: "ANCESTOR_OF_HELD_LOT",
        lot: {
          ...targetLot,
          organizationName: orgMap[targetLot.organizationId] || targetLot.organizationId,
        },
        events: enrichEvents(targetEvents),
        ancestorEvents: [],
        ancestors,
      };
    }
  }

  // 3. Kiểm tra nếu lô này trước đây thuộc orgId nhưng đã bàn giao đi (chỉ xem tới lúc bàn giao)
  const cutoffSeq = findCutoffSequenceForPastHolder(targetEvents, orgId);
  if (cutoffSeq !== null) {
    const visibleEvents = targetEvents.filter((e) => e.sequenceNo <= cutoffSeq);
    return {
      status: "ALLOWED_HISTORICAL",
      allowed: true,
      accessType: "PAST_HOLDER",
      cutoffSequenceNo: cutoffSeq,
      lot: {
        ...targetLot,
        organizationName: orgMap[targetLot.organizationId] || targetLot.organizationId,
      },
      events: enrichEvents(visibleEvents),
      ancestorEvents: [],
      ancestors: [],
    };
  }

  // 4. Không liên quan -> Chặn 403
  return {
    status: "FORBIDDEN",
    allowed: false,
    targetOrgId: targetLot.organizationId,
    lot: null,
    events: [],
    ancestors: [],
  };
}

module.exports = {
  evaluateLotAccess,
};
