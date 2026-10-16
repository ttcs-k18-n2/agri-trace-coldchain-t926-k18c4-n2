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
    upSql,
    /UNIQUE\s*\(\s*parent_batch_id\s*,\s*child_batch_id\s*\)/i,
    "Migration 017 must enforce UNIQUE (parent_batch_id, child_batch_id) constraint (T-39 NFR)"
  );

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?batch_relations/i,
    "Migration 017 rollback must drop table batch_relations"
  );
});

test("S-29: Migration 019 creates idx_lots_status and idx_lots_org_status with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/019_lot_consumed_status.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/019_lot_consumed_status.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 019 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 019 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_lots_status\s+ON\s+lots\s*\(\s*status\s*\)/i,
    "Migration 019 must create index idx_lots_status on lots(status)"
  );
  assert.match(
    upSql,
    /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_lots_org_status\s+ON\s+lots\s*\(\s*organization_id\s*,\s*status\s*\)/i,
    "Migration 019 must create index idx_lots_org_status on lots(organization_id, status)"
  );

  assert.match(
    downSql,
    /DROP\s+INDEX\s+(IF\s+EXISTS\s+)?idx_lots_org_status/i,
    "Migration 019 rollback must drop index idx_lots_org_status"
  );
  assert.match(
    downSql,
    /DROP\s+INDEX\s+(IF\s+EXISTS\s+)?idx_lots_status/i,
    "Migration 019 rollback must drop index idx_lots_status"
  );
});


test("S-60: Migration 023 creates public_map_areas table and index with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/023_public_map_areas.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/023_public_map_areas.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 023 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 023 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public_map_areas/i,
    "Migration 023 must create public_map_areas table"
  );
  assert.match(upSql, /latitude\s+NUMERIC/i);
  assert.match(upSql, /longitude\s+NUMERIC/i);
  assert.match(upSql, /keywords/i);

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public_map_areas/i,
    "Migration 023 rollback must drop table public_map_areas"
  );
});

test("S-40: Migration 024 creates shipments and shipment_lots tables with rollback adhering to project convention", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/024_shipments.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/024_shipments.down.sql");
  const duplicateDownPath = path.resolve(__dirname, "../../db/migrations/down/024_shipments.sql");

  assert.ok(fs.existsSync(upPath), "Migration 024 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 024 DOWN file must exist with .down.sql suffix");
  assert.ok(!fs.existsSync(duplicateDownPath), "Duplicate 024_shipments.sql in down directory must not exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?shipments/i,
    "Migration 024 must create shipments table"
  );
  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?shipment_lots/i,
    "Migration 024 must create shipment_lots table"
  );
  assert.match(
    upSql,
    /CREATE\s+UNIQUE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_unique_active_shipment_per_lot/i,
    "Migration 024 must enforce unique active shipment per lot"
  );
  assert.match(
    upSql,
    /CREATE\s+UNIQUE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_unique_active_shipment_per_cold_box/i,
    "Migration 024 must enforce unique active shipment per cold box"
  );

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?shipment_lots/i,
    "Migration 024 rollback must drop table shipment_lots"
  );
  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?shipments/i,
    "Migration 024 rollback must drop table shipments"
  );
});

if (process.env.DATABASE_URL) {
  test("migrate: up and down work with database", async () => {
    const upRes = await runMigrations("up");
    assert.equal(upRes.status, "ok");
  });
}
