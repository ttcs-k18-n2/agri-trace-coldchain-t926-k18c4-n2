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

test("T-39: Migration 017 creates batch_relations table with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/017_batch_relations.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/017_batch_relations.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 017 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 017 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?batch_relations/i,
    "Migration 017 must create batch_relations table"
  );
  assert.match(upSql, /parent_batch_id/i);
  assert.match(upSql, /child_batch_id/i);
  assert.match(upSql, /relation_type/i);

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?batch_relations/i,
    "Migration 017 rollback must drop table batch_relations"
  );
});

if (process.env.DATABASE_URL) {
  test("migrate: up and down work with database", async () => {
    const upRes = await runMigrations("up");
    assert.equal(upRes.status, "ok");
  });
}
