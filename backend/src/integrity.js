const crypto = require("crypto");

/**
 * Hash khởi đầu (Genesis hash) cho sự kiện đầu tiên của lô hàng (64 số 0).
 */
const GENESIS_HASH = "0".repeat(64);

/**
 * Chuẩn hóa chuỗi Canonical JSON (RFC 8785 JSON Canonicalization Scheme).
 * Sắp xếp các object keys đệ quy theo bảng mã Unicode để đảm bảo tính tất định (deterministic).
 * Dù thứ tự các trường trong payload khác nhau, chuỗi kết quả luôn luôn giống hệt nhau.
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
 * Tính event_hash theo công thức chuẩn K-01:
 * event_hash = SHA256( previous_hash + "|" + CanonicalJSON(payload) )
 *
 * @param {string} previousHash - Mã băm của sự kiện liền trước (hoặc GENESIS_HASH nếu là sự kiện đầu tiên)
 * @param {*} payload - Nội dung chi tiết của sự kiện
 * @returns {string} Mã băm của sự kiện hiện tại
 */
function calculateEventHash(previousHash, payload) {
  const prev = previousHash || GENESIS_HASH;
  const canonicalPayload = canonicalize(payload);
  const input = `${prev}|${canonicalPayload}`;
  return sha256(input);
}

module.exports = {
  GENESIS_HASH,
  canonicalize,
  canonicalizeJson: canonicalize, // Alias để tương thích K-01
  sha256,
  calculateEventHash,
};
