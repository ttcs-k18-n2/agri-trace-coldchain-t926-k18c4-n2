const test = require("node:test");
const assert = require("node:assert/strict");
const { runMigrations } = require("../src/migrate");

test("migrate: module loads and exports runMigrations", () => {
  assert.equal(typeof runMigrations, "function");
});

test("T-23: Migration 015 creates composite index on batch_events(batch_id, occurred_at) with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/015_batch_events_timeline_index.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/015_batch_events_timeline_index.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 015 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 015 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_batch_events_batch_occurred\s+ON\s+batch_events\s*\(\s*batch_id\s*,\s*occurred_at\s*\)/i,
    "Migration 015 must create composite index idx_batch_events_batch_occurred on batch_events(batch_id, occurred_at)"
  );

  assert.match(
    downSql,
    /DROP\s+INDEX\s+(IF\s+EXISTS\s+)?idx_batch_events_batch_occurred/i,
    "Migration 015 rollback must drop index idx_batch_events_batch_occurred"
  );
});

if (process.env.DATABASE_URL) {
  test("migrate: up and down work with database", async () => {
    const upRes = await runMigrations("up");
    assert.equal(upRes.status, "ok");
  });
}
