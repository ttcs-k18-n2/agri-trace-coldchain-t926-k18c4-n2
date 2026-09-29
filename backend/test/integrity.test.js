const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalizeJson, sha256, runBenchmark } = require("../benchmark/integrity_benchmark");

test("K-01: canonicalizeJson sorts keys consistently (RFC 8785)", () => {
  const obj1 = { b: 2, a: 1, c: { y: 20, x: 10 } };
  const obj2 = { a: 1, c: { x: 10, y: 20 }, b: 2 };
  assert.equal(canonicalizeJson(obj1), canonicalizeJson(obj2));
  assert.equal(canonicalizeJson(obj1), '{"a":1,"b":2,"c":{"x":10,"y":20}}');
});

test("K-01: sha256 produces valid 64-char hex hash", () => {
  const hash = sha256("test-data");
  assert.equal(hash.length, 64);
  assert.equal(hash, "a186000422feab857329c684e9fe91412b1a5db084100b37a98cfc95b62aa867");
});

test("K-01: 1000 events benchmark executes successfully and detects tampering", () => {
  const res = runBenchmark(1000);
  assert.equal(res.isValid, true);
  assert.equal(res.detectedTamper, true);
  assert.ok(res.writeDurationMs < 500); // Must be under 500ms for 1000 events
  assert.ok(res.verifyDurationMs < 500);
});
