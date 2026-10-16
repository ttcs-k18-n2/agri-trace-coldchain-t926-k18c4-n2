const crypto = require("node:crypto");

// Bảng mã không chứa ký tự dễ nhìn nhầm (loại trừ: 0, O, 1, I, L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LOT_CODE_LENGTH = 8;

/**
 * Sinh mã lô ngẫu nhiên không suy ra sản lượng/thứ tự theo chuẩn T-19.
 * Tiêu chí Jira T-19:
 * - Tiền tố: LOT-
 * - Độ dài: 8 ký tự ngẫu nhiên (Ví dụ: LOT-7KQX2M9R)
 * - Không chứa 0, O, 1, I, L để chống nhầm lẫn khi in ấn/đọc nhãn
 *
 * @param {number} [length=LOT_CODE_LENGTH] Số ký tự sinh ngẫu nhiên sau LOT-
 * @returns {string} Mã lô chuẩn
 */
function generateLotCode(length = LOT_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let result = "LOT-";
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

module.exports = {
  generateLotCode,
  ALPHABET,
  LOT_CODE_LENGTH,
};
