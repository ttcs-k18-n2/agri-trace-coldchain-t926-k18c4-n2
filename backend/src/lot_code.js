const crypto = require("node:crypto");

// Unambiguous alphabet excluding: 0, O (zero / letter O), 1, I, L (one / uppercase I / letter L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Sinh mã lô ngẫu nhiên không dự đoán được theo chuẩn T-19.
 * Định dạng: LOT-XXXXXXXXXX (10 ký tự an toàn, không chứa ký tự dễ nhầm lẫn: 0, O, 1, I, L).
 * @returns {string} Mã lô ngẫu nhiên (ví dụ: LOT-7KQX2M9RWD)
 */
function generateLotCode() {
  const bytes = crypto.randomBytes(10);
  let result = "LOT-";
  for (let i = 0; i < 10; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

module.exports = {
  generateLotCode,
  ALPHABET,
};
