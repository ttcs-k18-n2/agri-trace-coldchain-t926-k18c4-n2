/**
 * Module xử lý và chuẩn hóa khối lượng lô hàng (S-18 / T-42)
 * Đảm bảo độ chính xác tuyệt đối đến 0,001 kg (3 chữ số thập phân),
 * chuyển đổi sang milli-units số nguyên để triệt tiêu sai số dấu phẩy động (IEEE 754).
 */

const SCALE = 3;
const MULTIPLIER = 1000;

/**
 * Kiểm tra giá trị khối lượng có hợp lệ hay không:
 * - Là số không âm (nếu allowZero = true) hoặc số dương (mặc định allowZero = false)
 * - Tối đa 3 chữ số thập phân
 * - Không phải NaN, Infinity, null, undefined
 *
 * @param {number|string} val
 * @param {boolean} [allowZero=false]
 * @returns {boolean}
 */
function isValidQuantity(val, allowZero = false) {
  if (val === null || val === undefined || val === "") return false;
  const num = Number(val);
  if (!Number.isFinite(num)) return false;
  if (allowZero ? num < 0 : num <= 0) return false;

  const str = String(val).trim();
  // Khớp định dạng số chuẩn: ví dụ "40", "40.5", "0.001", "0"
  if (!/^\d+(\.\d+)?$/.test(str)) return false;

  const parts = str.split(".");
  if (parts.length === 2 && parts[1].length > SCALE) {
    return false;
  }
  return true;
}

/**
 * Chuyển đổi khối lượng sang số nguyên milli-units (1 kg = 1000 milli-units).
 * Dùng Math.round để tránh sai số dấu phẩy động trong JS.
 *
 * @param {number|string} val
 * @param {boolean} [allowZero=false]
 * @returns {number} Số nguyên milli-units
 */
function toMilliUnits(val, allowZero = false) {
  if (!isValidQuantity(val, allowZero)) {
    throw new Error(
      `Khối lượng không hợp lệ: "${val}". Phải là số ${allowZero ? "không âm" : "dương lớn hơn 0"} và có tối đa ${SCALE} chữ số thập phân.`
    );
  }
  return Math.round(Number(val) * MULTIPLIER);
}

/**
 * Chuyển đổi từ số nguyên milli-units về số thực chuẩn 3 chữ số thập phân.
 *
 * @param {number} milliUnits
 * @returns {number}
 */
function fromMilliUnits(milliUnits) {
  if (!Number.isFinite(milliUnits)) {
    throw new Error(`Giá trị milli-units không hợp lệ: ${milliUnits}`);
  }
  return Number((milliUnits / MULTIPLIER).toFixed(SCALE));
}

/**
 * Chuẩn hóa khối lượng về dạng số làm tròn 3 chữ số thập phân.
 *
 * @param {number|string} val
 * @param {boolean} [allowZero=false]
 * @returns {number}
 */
function normalizeQuantity(val, allowZero = false) {
  const milli = toMilliUnits(val, allowZero);
  return fromMilliUnits(milli);
}

/**
 * Chuẩn hóa khối lượng về chuỗi định dạng '0.000' để dùng an toàn trong câu truy vấn SQL NUMERIC.
 *
 * @param {number|string} val
 * @param {boolean} [allowZero=false]
 * @returns {string}
 */
function formatQuantityString(val, allowZero = false) {
  const milli = toMilliUnits(val, allowZero);
  return (milli / MULTIPLIER).toFixed(SCALE);
}

/**
 * Kiểm tra danh sách phân tách lô (splits / subLots) theo nghiệp vụ S-17/S-18:
 * - Danh sách không rỗng
 * - Từng phần tử có khối lượng > 0 và <= 3 chữ số thập phân
 * - Tính tổng khối lượng chính xác theo milli-units
 *
 * @param {Array} splitItems
 * @returns {{valid: boolean, error?: string, message?: string, totalMilli?: number, totalQuantity?: number, index?: number}}
 */
function validateSplitItems(splitItems) {
  if (!Array.isArray(splitItems) || splitItems.length === 0) {
    return {
      valid: false,
      error: "INVALID_SPLITS",
      message: "Danh sách lô con cần tách (splits) không được để trống.",
    };
  }

  let totalMilli = 0;
  for (let i = 0; i < splitItems.length; i++) {
    const s = splitItems[i];
    const q = s ? s.quantity : undefined;
    if (!isValidQuantity(q, false)) {
      return {
        valid: false,
        error: "INVALID_QUANTITY",
        message: `Khối lượng của lô con thứ ${i + 1} phải là số dương lớn hơn 0 và có tối đa ${SCALE} chữ số thập phân.`,
        index: i,
      };
    }
    totalMilli += toMilliUnits(q, false);
  }

  return {
    valid: true,
    totalMilli,
    totalQuantity: fromMilliUnits(totalMilli),
  };
}

/**
 * Kiểm tra danh sách gộp lô (items / parents) theo nghiệp vụ S-19:
 * - Danh sách là mảng có ít nhất 2 phần tử
 * - Không trùng lặp mã lô mẹ trong cùng một yêu cầu
 * - Từng phần tử có mã lô và khối lượng lấy hợp lệ (> 0, tối đa 3 chữ số thập phân)
 * - Tính tổng khối lượng gộp chính xác theo milli-units
 *
 * @param {Array} items
 * @returns {{valid: boolean, error?: string, message?: string, totalMilli?: number, totalQuantity?: number, normalizedItems?: Array}}
 */
function validateMergeItems(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return {
      valid: false,
      error: "INVALID_MERGE_INPUT",
      message: "Cần chọn ít nhất 2 lô hàng để thực hiện gộp lô.",
    };
  }

  const seenIds = new Set();
  const normalizedItems = [];
  let totalMilli = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const lotId = String(
      item ? (item.parent_batch_id || item.parentBatchId || item.lotId || item.id || "") : ""
    ).trim();

    if (!lotId) {
      return {
        valid: false,
        error: "MISSING_LOT_ID",
        message: `Lô thứ ${i + 1} thiếu mã lô hàng (parent_batch_id).`,
      };
    }

    if (seenIds.has(lotId)) {
      return {
        valid: false,
        error: "DUPLICATE_PARENT_LOT",
        message: `Lô [${lotId}] bị trùng lặp trong danh sách gộp.`,
      };
    }
    seenIds.add(lotId);

    const rawQty = item.take_quantity !== undefined
      ? item.take_quantity
      : (item.takeQuantity !== undefined ? item.takeQuantity : item.quantity);

    if (!isValidQuantity(rawQty, false)) {
      return {
        valid: false,
        error: "INVALID_QUANTITY",
        message: `Khối lượng lấy của lô [${lotId}] phải là số dương lớn hơn 0 và có tối đa ${SCALE} chữ số thập phân.`,
        index: i,
      };
    }

    const itemMilli = toMilliUnits(rawQty, false);
    totalMilli += itemMilli;
    normalizedItems.push({
      parent_batch_id: lotId,
      take_quantity: fromMilliUnits(itemMilli),
      take_milli: itemMilli,
      take_quantity_str: formatQuantityString(rawQty, false),
    });
  }

  // Chống deadlock: Sắp xếp danh sách theo parent_batch_id tăng dần
  normalizedItems.sort((a, b) => a.parent_batch_id.localeCompare(b.parent_batch_id));

  return {
    valid: true,
    totalMilli,
    totalQuantity: fromMilliUnits(totalMilli),
    normalizedItems,
  };
}

module.exports = {
  SCALE,
  MULTIPLIER,
  isValidQuantity,
  toMilliUnits,
  fromMilliUnits,
  normalizeQuantity,
  formatQuantityString,
  validateSplitItems,
  validateMergeItems,
};
