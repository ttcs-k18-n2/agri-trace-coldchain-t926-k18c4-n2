const crypto = require("crypto");

/**
 * Hash khởi đầu (Genesis hash) cho sự kiện đầu tiên của lô hàng (64 số 0).
 */
const GENESIS_HASH = "0".repeat(64);

/**
 * Chuẩn hóa chuỗi Canonical JSON nội bộ (Internal Canonical JSON theo Spike K-01).
 * Sắp xếp các object keys đệ quy theo bảng mã Unicode để đảm bảo tính tất định (deterministic).
 * Dù thứ tự các trường trong payload/object khác nhau, chuỗi kết quả luôn luôn giống hệt nhau.
 *
 * @param {*} val - Dữ liệu cần chuẩn hóa
 * @returns {string} Chuỗi JSON đã chuẩn hóa
 */
function canonicalize(val) {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return "[" + val.map(canonicalize).join(",") + "]";
  }

  const sortedKeys = Object.keys(val).sort();
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ":" + canonicalize(val[key])
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Tính mã băm SHA-256 từ chuỗi UTF-8.
 *
 * @param {string} data - Chuỗi dữ liệu đầu vào
 * @returns {string} Chuỗi hex 64 ký tự
 */
function sha256(data) {
  return crypto.createHash("sha256").update(String(data), "utf8").digest("hex");
}

/**
 * Chuẩn hóa đối tượng sự kiện thành cấu trúc hashPayload chuẩn K-01 trước khi băm.
 * Toàn bộ các trường định danh và thời gian (batchId, sequenceNo, eventType, organizationId,
 * actorUserId, occurredAt) cùng với payload đều được đóng gói vào chuỗi băm để chống giả mạo toàn diện.
 *
 * @param {object} event - Bản ghi hoặc dữ liệu sự kiện
 * @returns {object} hashPayload đã chuẩn hóa
 */
function createEventHashPayload(event) {
  const occurredAt = event.occurredAt !== undefined ? event.occurredAt : event.occurred_at;
  const occurredAtIso = occurredAt instanceof Date
    ? occurredAt.toISOString()
    : (occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString());

  return {
    actorUserId: (event.actorUserId !== undefined ? event.actorUserId : event.actor_user_id) || null,
    batchId: event.batchId !== undefined ? event.batchId : event.batch_id,
    eventType: event.eventType !== undefined ? event.eventType : event.event_type,
    occurredAt: occurredAtIso,
    organizationId: event.organizationId !== undefined ? event.organizationId : event.organization_id,
    payload: event.payload !== undefined ? event.payload : null,
    sequenceNo: Number(event.sequenceNo !== undefined ? event.sequenceNo : event.sequence_no),
  };
}

/**
 * Tính event_hash theo công thức chuẩn K-01:
 * event_hash = SHA256( previous_hash + "|" + CanonicalJSON(hashPayload) )
 *
 * @param {string} previousHash - Mã băm của sự kiện liền trước (hoặc GENESIS_HASH nếu là sự kiện đầu tiên)
 * @param {object} eventOrPayload - Toàn bộ dữ liệu sự kiện (batchId, sequenceNo, eventType, payload, organizationId, actorUserId, occurredAt)
 *                                  hoặc payload/hashPayload đã chuẩn hóa
 * @returns {string} Mã băm của sự kiện hiện tại
 */
function calculateEventHash(previousHash, eventOrPayload) {
  const prev = previousHash || GENESIS_HASH;
  const isFullEvent = eventOrPayload && typeof eventOrPayload === "object" && (
    eventOrPayload.eventType !== undefined ||
    eventOrPayload.event_type !== undefined ||
    eventOrPayload.batchId !== undefined ||
    eventOrPayload.batch_id !== undefined
  );
  const dataToHash = isFullEvent ? createEventHashPayload(eventOrPayload) : eventOrPayload;
  const canonicalString = canonicalize(dataToHash);
  const input = `${prev}|${canonicalString}`;
  return sha256(input);
}

module.exports = {
  GENESIS_HASH,
  canonicalize,
  canonicalizeJson: canonicalize, // Alias để tương thích K-01
  sha256,
  createEventHashPayload,
  calculateEventHash,
};
