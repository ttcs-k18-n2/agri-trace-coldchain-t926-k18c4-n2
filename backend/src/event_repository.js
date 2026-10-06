const crypto = require("crypto");
const { GENESIS_HASH, calculateEventHash } = require("./integrity");

/**
 * In-memory fallback lưu trữ danh sách events khi không có kết nối PostgreSQL.
 */
const inMemoryBatchEvents = [];

let _appendHookForTesting = null;

function setAppendHookForTesting(hook) {
  _appendHookForTesting = hook;
}

/**
 * Khóa tuần tự hóa in-memory để đảm bảo xếp hàng an toàn khi có nhiều request đồng thời ghi vào cùng batchId.
 */
const batchLocks = new Map();

async function withBatchLock(batchId, fn) {
  const currentLock = batchLocks.get(batchId) || Promise.resolve();
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const queuedLock = currentLock.then(() => nextLock);
  batchLocks.set(batchId, queuedLock);

  await currentLock;
  try {
    return await fn();
  } finally {
    release();
    if (batchLocks.get(batchId) === queuedLock) {
      batchLocks.delete(batchId);
    }
  }
}

/**
 * Ghi nhận một sự kiện mới vào chuỗi hash chain của lô hàng (batch).
 * Hàm này có thể chạy trong một transaction của client PostgreSQL hoặc in-memory.
 * Sử dụng SELECT ... FOR UPDATE (K-01) để khóa dòng sự kiện cuối cùng, ngăn chặn race condition khi ghi đồng thời.
 *
 * @param {object|null} client - pg.Client hoặc pg.Pool (nếu chạy với PostgreSQL) hoặc null (in-memory)
 * @param {object} data - Thông tin sự kiện
 * @param {string} data.batchId - Mã lô hàng (lotId / batchId)
 * @param {string} data.eventType - Loại sự kiện (e.g. "HARVEST_CREATED")
 * @param {object} data.payload - Nội dung dữ liệu sự kiện
 * @param {string} data.organizationId - Mã tổ chức sở hữu
 * @param {string} [data.actorUserId] - ID người thực hiện
 * @param {string|Date} [data.occurredAt] - Thời điểm xảy ra sự kiện
 * @returns {Promise<object>} Bản ghi sự kiện vừa được tạo
 */
async function appendBatchEvent(client, data) {
  if (typeof _appendHookForTesting === "function") {
    _appendHookForTesting(data);
  }
  const { batchId, eventType, payload, organizationId, actorUserId, occurredAt } = data;

  if (!batchId) {
    throw new Error("batchId là bắt buộc khi ghi nhận sự kiện.");
  }
  if (!eventType) {
    throw new Error("eventType là bắt buộc khi ghi nhận sự kiện.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("payload phải là một object dữ liệu hợp lệ.");
  }
  if (!organizationId) {
    throw new Error("organizationId là bắt buộc khi ghi nhận sự kiện.");
  }

  const eventOccurredAt = occurredAt ? new Date(occurredAt) : new Date();

  // 1. Nếu có PostgreSQL client
  if (client && typeof client.query === "function") {
    // 1.1 Khóa hàng của lô hàng với FOR UPDATE (K-01) để tuần tự hóa và ngăn race condition
    await client.query(`SELECT id FROM lots WHERE id = $1 FOR UPDATE`, [batchId]);

    // 1.2 Lấy sự kiện cuối cùng của lô hàng (hàng cha lots đã được khóa FOR UPDATE ở trên)
    const lastEventRes = await client.query(
      `SELECT sequence_no, event_hash 
       FROM batch_events 
       WHERE batch_id = $1 
       ORDER BY sequence_no DESC 
       LIMIT 1`,
      [batchId]
    );

    const lastEvent = lastEventRes.rows[0];
    const sequenceNo = lastEvent ? Number(lastEvent.sequence_no) + 1 : 1;
    const previousHash = lastEvent ? lastEvent.event_hash : GENESIS_HASH;

    // Đóng gói toàn bộ metadata của sự kiện vào chuỗi băm chuẩn K-01
    const eventDataToHash = {
      batchId,
      sequenceNo,
      eventType,
      payload,
      organizationId,
      actorUserId: actorUserId || null,
      occurredAt: eventOccurredAt,
    };
    const eventHash = calculateEventHash(previousHash, eventDataToHash);
    const eventId = "EVT-" + crypto.randomUUID();

    const insertRes = await client.query(
      `INSERT INTO batch_events (
        id, batch_id, sequence_no, event_type, payload,
        organization_id, actor_user_id, occurred_at, previous_hash, event_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        eventId,
        batchId,
        sequenceNo,
        eventType,
        payload,
        organizationId,
        actorUserId || null,
        eventOccurredAt,
        previousHash,
        eventHash,
      ]
    );

    const row = insertRes.rows[0];
    return {
      id: row.id,
      batchId: row.batch_id,
      sequenceNo: Number(row.sequence_no),
      eventType: row.event_type,
      payload: row.payload,
      organizationId: row.organization_id,
      actorUserId: row.actor_user_id,
      occurredAt: row.occurred_at,
      previousHash: row.previous_hash,
      eventHash: row.event_hash,
      createdAt: row.created_at,
    };
  }

  // 2. In-memory fallback: Sử dụng mutex queue theo batchId để đảm bảo an toàn ghi đồng thời
  return await withBatchLock(batchId, async () => {
    const batchExistingEvents = inMemoryBatchEvents
      .filter((e) => e.batch_id === batchId || e.batchId === batchId)
      .sort((a, b) => (a.sequence_no || a.sequenceNo) - (b.sequence_no || b.sequenceNo));

    const lastEvent = batchExistingEvents[batchExistingEvents.length - 1];
    const sequenceNo = lastEvent ? (lastEvent.sequence_no || lastEvent.sequenceNo) + 1 : 1;
    const previousHash = lastEvent ? (lastEvent.event_hash || lastEvent.eventHash) : GENESIS_HASH;

    // Đóng gói toàn bộ metadata của sự kiện vào chuỗi băm chuẩn K-01
    const eventDataToHash = {
      batchId,
      sequenceNo,
      eventType,
      payload,
      organizationId,
      actorUserId: actorUserId || null,
      occurredAt: eventOccurredAt,
    };
    const eventHash = calculateEventHash(previousHash, eventDataToHash);
    const eventId = "EVT-" + crypto.randomUUID();

    const orgName =
      data.organizationName ||
      (payload && payload.organizationName) ||
      ORG_NAME_FALLBACKS[organizationId] ||
      organizationId;

    const newEvent = {
      id: eventId,
      batchId,
      batch_id: batchId,
      sequenceNo,
      sequence_no: sequenceNo,
      eventType,
      event_type: eventType,
      payload,
      organizationId,
      organization_id: organizationId,
      organizationName: orgName,
      actorUserId: actorUserId || null,
      actor_user_id: actorUserId || null,
      occurredAt: eventOccurredAt.toISOString(),
      occurred_at: eventOccurredAt.toISOString(),
      previousHash,
      previous_hash: previousHash,
      eventHash,
      event_hash: eventHash,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    inMemoryBatchEvents.push(newEvent);
    return newEvent;
  });
}

const ORG_NAME_FALLBACKS = {
  "org-001": "Nông trại Xanh (Org 1)",
  "org-002": "HTX Chế biến Nông sản (Org 2)",
  "org-003": "Nhà phân phối Chuỗi Lạnh (Org 3)",
};

/**
 * Lấy toàn bộ danh sách sự kiện theo thứ tự sequence_no của một lô hàng.
 * Tối ưu hóa cho S-13 (T-31): LEFT JOIN organizations để trả về trực tiếp tên tổ chức,
 * loại bỏ hoàn toàn các truy vấn con (N+1 query) và đảm bảo thời gian truy vấn < 200ms.
 *
 * @param {object|null} client - pg.Client hoặc pg.Pool hoặc null
 * @param {string} batchId - Mã lô hàng
 * @param {object} [options] - Tuỳ chọn { limit, offset }
 * @returns {Promise<Array<object>>}
 */
async function getBatchEvents(client, batchId, options = {}) {
  const { limit, offset } = options || {};
  if (client && typeof client.query === "function") {
    let sql = `
      SELECT b.id, b.batch_id AS "batchId", b.sequence_no AS "sequenceNo", b.event_type AS "eventType",
             b.payload, b.organization_id AS "organizationId",
             COALESCE(o.name, b.organization_id) AS "organizationName",
             b.actor_user_id AS "actorUserId",
             b.occurred_at AS "occurredAt", b.previous_hash AS "previousHash", b.event_hash AS "eventHash",
             b.created_at AS "createdAt"
      FROM batch_events b
      LEFT JOIN organizations o ON b.organization_id = o.id
      WHERE b.batch_id = $1
      ORDER BY b.sequence_no ASC
    `;
    const params = [batchId];
    if (limit && Number.isInteger(Number(limit))) {
      params.push(Number(limit));
      sql += ` LIMIT $${params.length}`;
      if (offset && Number.isInteger(Number(offset))) {
        params.push(Number(offset));
        sql += ` OFFSET $${params.length}`;
      }
    }

    const res = await client.query(sql, params);
    return res.rows.map((r) => ({
      ...r,
      sequenceNo: Number(r.sequenceNo),
    }));
  }

  let list = inMemoryBatchEvents
    .filter((e) => e.batch_id === batchId || e.batchId === batchId)
    .sort((a, b) => (a.sequence_no || a.sequenceNo) - (b.sequence_no || b.sequenceNo))
    .map((e) => {
      const orgId = e.organizationId || e.organization_id;
      const orgName =
        e.organizationName ||
        (e.payload && e.payload.organizationName) ||
        ORG_NAME_FALLBACKS[orgId] ||
        orgId;
      return {
        id: e.id,
        batchId: e.batchId || e.batch_id,
        sequenceNo: Number(e.sequenceNo || e.sequence_no),
        eventType: e.eventType || e.event_type,
        payload: e.payload,
        organizationId: orgId,
        organizationName: orgName,
        actorUserId: e.actorUserId || e.actor_user_id,
        occurredAt: e.occurredAt || e.occurred_at,
        previousHash: e.previousHash || e.previous_hash,
        eventHash: e.eventHash || e.event_hash,
        createdAt: e.createdAt || e.created_at,
      };
    });

  if (offset && Number.isInteger(Number(offset))) {
    list = list.slice(Number(offset));
  }
  if (limit && Number.isInteger(Number(limit))) {
    list = list.slice(0, Number(limit));
  }
  return list;
}

const { verifyBatchEventChain } = require("./integrity_verifier");

module.exports = {
  appendBatchEvent,
  getBatchEvents,
  verifyBatchEventChain,
  inMemoryBatchEvents,
  setAppendHookForTesting,
};
