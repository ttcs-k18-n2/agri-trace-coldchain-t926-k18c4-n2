const test = require("node:test");
const assert = require("node:assert/strict");
const { generateLotCode, ALPHABET, LOT_CODE_LENGTH } = require("../src/lot_code");

test("T-19: generateLotCode generates valid format LOT-XXXXXXXX (8 random chars)", () => {
  const code = generateLotCode();
  assert.equal(LOT_CODE_LENGTH, 8);
  assert.match(code, /^LOT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(code.length, 12); // "LOT-" (4) + 8 chars = 12
  assert.equal(ALPHABET.length, 31);
});

test("T-19: generateLotCode never contains ambiguous characters (0, O, 1, I, L)", () => {
  const ambiguousChars = ["0", "O", "1", "I", "L"];
  for (let i = 0; i < 500; i++) {
    const code = generateLotCode();
    for (const char of ambiguousChars) {
      assert.equal(code.slice(4).includes(char), false, `Code ${code} must not contain '${char}'`);
    }
  }
});

test("T-19: 10,000 generated 8-char lot codes are unique with zero collisions", () => {
  const codes = new Set();
  const count = 10000;
  for (let i = 0; i < count; i++) {
    codes.add(generateLotCode());
  }
  assert.equal(codes.size, count, "Set size must equal 10,000 unique codes");
});
