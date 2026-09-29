const test = require("node:test");
const assert = require("node:assert/strict");

test("deliberate failure to test CI rejection", () => {
  assert.equal(1 + 1, 3, "CI should catch this deliberate failure");
});
