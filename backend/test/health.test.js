const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app } = require("../src/server");

test("GET /health returns JSON with service status and commit info", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.service, "agri-trace-backend");
  assert.ok("commit" in res.body, "Health response should contain commit traceability");
  assert.equal(typeof res.body.commit, "string");
  // Ensure no sensitive database credentials leaked
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.DATABASE_URL, undefined);
});

test("GET /api/health behaves identically without leaking sensitive config", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.ok("database" in res.body);
  assert.equal(res.body.password, undefined);
});
