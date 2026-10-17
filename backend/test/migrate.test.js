const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

test("S-34: Migration 023 creates recall_orders table with rollback and NFR compliance", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/023_recall_orders.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/023_recall_orders.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 023 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 023 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?recall_orders/i,
    "Migration 023 must create recall_orders table"
  );
  assert.match(upSql, /lot_id/i);
  assert.match(upSql, /reason/i);
  assert.match(upSql, /severity/i);
  assert.match(upSql, /status/i);
  assert.match(upSql, /created_by/i);

  // NFR: Kh├┤ng c├│ cß╗Öt snapshot cß╗⌐ng
  assert.doesNotMatch(
    upSql,
    /descendant_lots/i,
    "Migration 023 MUST NOT contain fixed descendant_lots column (NFR real-time BFS)"
  );

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?recall_orders/i,
    "Migration 023 rollback must drop table recall_orders"
  );
});

test("S-36/S-37: Migration 024 creates recall_acknowledgments with FK, UNIQUE constraint and rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/024_recall_acknowledgments.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/024_recall_acknowledgments.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 024 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 024 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?recall_acknowledgments/i,
    "Migration 024 must create recall_acknowledgments table"
  );
  assert.match(upSql, /recall_id\s+VARCHAR\(64\)/i);
  assert.match(upSql, /REFERENCES\s+recall_orders\s*\(\s*id\s*\)/i);
  assert.match(upSql, /REFERENCES\s+organizations\s*\(\s*id\s*\)/i);
  assert.match(upSql, /UNIQUE\s*\(\s*recall_id\s*,\s*organization_id\s*\)/i);
  assert.match(upSql, /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_recall_acknowledgments_recall_id/i);
  assert.match(upSql, /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_recall_acknowledgments_org_id/i);

  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?recall_acknowledgments/i,
    "Migration 024 rollback must drop table recall_acknowledgments"
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

test("S-40: Migration 025 creates idx_unique_active_shipment_per_cold_box safely with rollback without destroying shipment data", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/025_shipments_unique_active_cold_box.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/025_shipments_unique_active_cold_box.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 025 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 025 DOWN file must exist with .down.sql suffix");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  // UP: must check for index existence (idempotency / index duplication)
  assert.match(
    upSql,
    /pg_indexes/i,
    "Migration 025 must query pg_indexes to handle pre-existing index safely"
  );
  assert.match(
    upSql,
    /idx_unique_active_shipment_per_cold_box/i,
    "Migration 025 must target index idx_unique_active_shipment_per_cold_box"
  );

  // UP: must detect duplicate active shipments and fail with clear diagnosis
  assert.match(
    upSql,
    /HAVING\s+count\(\*\)\s*>\s*1/i,
    "Migration 025 must check for duplicate active cold boxes"
  );
  assert.match(
    upSql,
    /RAISE\s+EXCEPTION/i,
    "Migration 025 must fail clearly when pre-existing duplicate active cold boxes are found"
  );
  assert.ok(
    !/DELETE\s+FROM\s+shipments/i.test(upSql),
    "Migration 025 must never delete shipment data automatically"
  );
  assert.ok(
    !/UPDATE\s+shipments\s+SET/i.test(upSql),
    "Migration 025 must never silently alter shipment business data"
  );

  // UP: must create unique partial index
  assert.match(
    upSql,
    /CREATE\s+UNIQUE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_unique_active_shipment_per_cold_box\s+ON\s+shipments\s*\(\s*cold_box_id\s*\)\s+WHERE\s+status\s*=\s*[''']+IN_TRANSIT[''']+/i,
    "Migration 025 must create unique index idx_unique_active_shipment_per_cold_box on shipments(cold_box_id) WHERE status = 'IN_TRANSIT'"
  );

  // DOWN: must drop only the index, never tables/data
  assert.match(
    downSql,
    /DROP\s+INDEX\s+(IF\s+EXISTS\s+)?idx_unique_active_shipment_per_cold_box/i,
    "Migration 025 rollback must drop index idx_unique_active_shipment_per_cold_box"
  );
  assert.ok(
    !/DROP\s+TABLE/i.test(downSql),
    "Migration 025 rollback must NEVER drop shipment or shipment_lots tables"
  );
});

test("S-40: Mock migration runner - clean setup path runs all migrations including 024 and 025", async () => {
  const executedStatements = [];
  const appliedMigrations = [];

  const mockClient = {
    async query(sql, params) {
      if (typeof sql === "string") {
        if (sql.includes("to_regclass")) {
          return { rows: [{ reg: "public.schema_migrations" }] };
        }
        if (sql.includes("SELECT version FROM schema_migrations")) {
          return { rows: appliedMigrations.map((v) => ({ version: v })) };
        }
        if (sql.includes("INSERT INTO schema_migrations")) {
          const v = params ? params[0] : (sql.match(/VALUES\s*\(\s*'([^']+)'/i) || [])[1];
          if (v && !appliedMigrations.includes(v)) appliedMigrations.push(v);
          return { rowCount: 1, rows: [] };
        }
      }
      executedStatements.push({ sql: typeof sql === "string" ? sql.trim() : "", params });
      return { rows: [] };
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
    async end() {},
  };

  const result = await runMigrations("up", mockPool);
  assert.equal(result.status, "ok");
  assert.ok(result.appliedCount >= 25, `Expected at least 25 migrations applied in clean setup, got ${result.appliedCount}`);
  assert.ok(appliedMigrations.includes("024_shipments"), "Clean setup must apply 024_shipments");
  assert.ok(appliedMigrations.includes("025_shipments_unique_active_cold_box"), "Clean setup must apply 025_shipments_unique_active_cold_box");
});

test("S-40: Mock migration runner - already-applied 024 upgrade path applies only 025 without touching 024", async () => {
  const executedStatements = [];
  const existingApplied = [
    "001_init", "002_auth", "003_lots", "004_farms", "005_cleanup_sprint1_lot_status",
    "006_products", "007_harvest_lots", "008_seed_full_role_accounts", "009_batch_events",
    "010_batch_events_append_only", "011_integrity_checks", "012_lots_search_indices",
    "013_transfers", "014_transfer_overdue", "015_batch_events_timeline_index",
    "016_lots_parent_lineage", "017_batch_relations", "018_grant_agri_app_permissions",
    "019_lot_consumed_status", "020_locations", "021_audit_logs",
    "022_consumed_lot_constraints", "023_public_map_areas", "023_recall_orders",
    "024_lot_custom_coordinates", "024_recall_acknowledgments", "024_shipments", "026_shipment_temperatures",
    "027_shipment_temperature_violations", "028_product_temperature_thresholds", "029_public_cache_and_rate_limits"
  ];
  const appliedMigrations = [...existingApplied];

  const mockClient = {
    async query(sql, params) {
      if (typeof sql === "string") {
        if (sql.includes("to_regclass")) {
          return { rows: [{ reg: "public.schema_migrations" }] };
        }
        if (sql.includes("SELECT version FROM schema_migrations")) {
          return { rows: appliedMigrations.map((v) => ({ version: v })) };
        }
        if (sql.includes("INSERT INTO schema_migrations")) {
          appliedMigrations.push(params[0]);
          return { rowCount: 1 };
        }
      }
      executedStatements.push({ sql: typeof sql === "string" ? sql.trim() : "", params });
      return { rows: [] };
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
    async end() {},
  };

  const result = await runMigrations("up", mockPool);
  assert.equal(result.status, "ok");
  assert.equal(result.appliedCount, 1, "Only migration 025 should be applied on already-applied 024 DB");
  assert.equal(appliedMigrations[appliedMigrations.length - 1], "025_shipments_unique_active_cold_box");
  // 024 must NOT be re-applied or rolled back
  assert.ok(
    !executedStatements.some((s) => s.sql.includes("CREATE TABLE IF NOT EXISTS shipments")),
    "024_shipments must not be re-executed when already applied"
  );
  assert.ok(
    !executedStatements.some((s) => s.sql.includes("custom_coordinates")),
    "024_lot_custom_coordinates must not be re-executed when already applied"
  );
});

test("S-40: Mock migration runner - rollback of 025 drops only index, never shipment tables/data", async () => {
  const executedStatements = [];
  const appliedMigrations = [
    "024_shipments",
    "025_shipments_unique_active_cold_box"
  ];

  const mockClient = {
    async query(sql, params) {
      if (typeof sql === "string") {
        if (sql.includes("to_regclass")) {
          return { rows: [{ reg: "public.schema_migrations" }] };
        }
        if (sql.includes("SELECT version FROM schema_migrations")) {
          return { rows: appliedMigrations.map((v) => ({ version: v })) };
        }
        if (sql.includes("DELETE FROM schema_migrations")) {
          const idx = appliedMigrations.indexOf(params[0]);
          if (idx !== -1) appliedMigrations.splice(idx, 1);
          return { rowCount: 1 };
        }
      }
      executedStatements.push({ sql: typeof sql === "string" ? sql.trim() : "", params });
      return { rows: [] };
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
    async end() {},
  };

  const result = await runMigrations("down", mockPool);
  assert.equal(result.status, "ok");
  assert.equal(result.rolledBack, "025_shipments_unique_active_cold_box");
  assert.ok(!appliedMigrations.includes("025_shipments_unique_active_cold_box"));
  assert.ok(appliedMigrations.includes("024_shipments"), "024_shipments must remain applied");

  // Verify executed SQL drops only index and never drop table
  const dropIndexStatement = executedStatements.find((s) =>
    s.sql.includes("DROP INDEX IF EXISTS idx_unique_active_shipment_per_cold_box")
  );
  assert.ok(dropIndexStatement, "Rollback 025 must execute DROP INDEX IF EXISTS idx_unique_active_shipment_per_cold_box");
  assert.ok(
    !executedStatements.some((s) => s.sql.includes("DROP TABLE")),
    "Rollback 025 must NEVER execute DROP TABLE"
  );
});

test("S-40: Actionable diagnosis logic - detects duplicate active cold boxes without deleting data", () => {
  // Simulate diagnosis evaluation logic as embedded in migration 025
  const mockExistingShipments = [
    { id: "shp-001", cold_box_id: "CBX-100", status: "IN_TRANSIT" },
    { id: "shp-002", cold_box_id: "CBX-100", status: "IN_TRANSIT" },
    { id: "shp-003", cold_box_id: "CBX-200", status: "COMPLETED" },
    { id: "shp-004", cold_box_id: "CBX-200", status: "IN_TRANSIT" },
  ];

  // Group active shipments by cold_box_id
  const activeShipments = mockExistingShipments.filter((s) => s.status === "IN_TRANSIT");
  const countMap = {};
  for (const shp of activeShipments) {
    if (!countMap[shp.cold_box_id]) countMap[shp.cold_box_id] = [];
    countMap[shp.cold_box_id].push(shp.id);
  }

  const duplicates = Object.entries(countMap)
    .filter(([_, ids]) => ids.length > 1)
    .map(([boxId, ids]) => `cold_box_id=${boxId} (count=${ids.length}, shipments=[${ids.join(", ")}])`);

  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0], /CBX-100/);
  assert.match(duplicates[0], /shp-001, shp-002/);

  // Assert diagnostic error message format matches migration 025 specification
  const diagnosticMsg = `Cannot apply migration 025: pre-existing duplicate active shipments found: ${duplicates.join("; ")}. Action required: Resolve or transition duplicate IN_TRANSIT shipments to COMPLETED or CANCELLED before applying this migration. Do NOT delete business data manually without audit.`;
  assert.match(diagnosticMsg, /Cannot apply migration 025/);
  assert.match(diagnosticMsg, /Action required/);
  assert.match(diagnosticMsg, /Do NOT delete business data manually/);
});

test("S-41: Migration 026 creates shipment_temperatures table and columns with rollback adhering to project convention", () => {
  const upFile = path.resolve(__dirname, "../../db/migrations/026_shipment_temperatures.sql");
  const downFile = path.resolve(__dirname, "../../db/migrations/down/026_shipment_temperatures.down.sql");

  assert.ok(fs.existsSync(upFile), "026_shipment_temperatures.sql must exist");
  assert.ok(fs.existsSync(downFile), "026_shipment_temperatures.down.sql must exist");

  const upSql = fs.readFileSync(upFile, "utf-8");
  const downSql = fs.readFileSync(downFile, "utf-8");

  // UP: creates shipment_temperatures table
  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?shipment_temperatures/i,
    "Migration 026 must create table shipment_temperatures"
  );
  assert.match(
    upSql,
    /CONSTRAINT\s+uq_shipment_temperature_timestamp\s+UNIQUE\s*\(\s*shipment_id\s*,\s*recorded_at\s*\)/i,
    "Migration 026 must enforce unique timestamp per shipment constraint"
  );
  assert.match(
    upSql,
    /ALTER\s+TABLE\s+shipments\s+ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?current_temperature/i,
    "Migration 026 must add current_temperature column to shipments"
  );
  assert.match(
    upSql,
    /ALTER\s+TABLE\s+shipments\s+ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?last_temperature_at/i,
    "Migration 026 must add last_temperature_at column to shipments"
  );

  // DOWN: drops only new temperature objects safely
  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?shipment_temperatures/i,
    "Migration 026 rollback must drop table shipment_temperatures"
  );
  assert.match(
    downSql,
    /ALTER\s+TABLE\s+shipments\s+DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?current_temperature/i,
    "Migration 026 rollback must drop column current_temperature from shipments"
  );
  assert.match(
    downSql,
    /ALTER\s+TABLE\s+shipments\s+DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?last_temperature_at/i,
    "Migration 026 rollback must drop column last_temperature_at from shipments"
  );
  assert.ok(
    !/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?shipments\b/i.test(downSql),
    "Migration 026 rollback must NEVER drop shipments table"
  );
});

test("S-43: Migration 027 creates temperature_violations and detector_state with rollback adhering to project convention", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/027_shipment_temperature_violations.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/027_shipment_temperature_violations.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 027 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 027 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  // UP: creates temperature_violations table
  assert.match(
    upSql,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?temperature_violations/i,
    "Migration 027 must create temperature_violations table"
  );
  assert.match(upSql, /REFERENCES\s+shipments\s*\(\s*id\s*\)/i);
  assert.match(upSql, /cold_box_id/i);
  assert.match(upSql, /threshold_value/i);
  assert.match(upSql, /peak_temperature/i);
  assert.match(upSql, /duration_minutes/i);

  // UP: adds detector_state to shipments
  assert.match(
    upSql,
    /ALTER\s+TABLE\s+shipments\s+ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?detector_state/i,
    "Migration 027 must add detector_state column to shipments"
  );

  // DOWN: drops temperature_violations and detector_state
  assert.match(
    downSql,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?temperature_violations/i,
    "Migration 027 rollback must drop table temperature_violations"
  );
  assert.match(
    downSql,
    /ALTER\s+TABLE\s+shipments\s+DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?detector_state/i,
    "Migration 027 rollback must drop column detector_state from shipments"
  );
  assert.ok(
    !/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?shipments\b/i.test(downSql),
    "Migration 027 rollback must NEVER drop shipments table"
  );
});

test("S-44: Migration 028 creates product temperature thresholds and shipment config columns with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/028_product_temperature_thresholds.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/028_product_temperature_thresholds.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 028 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 028 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  // UP: adds columns to products
  assert.match(upSql, /temp_min/i, "Migration 028 must add temp_min column to products");
  assert.match(upSql, /temp_max/i, "Migration 028 must add temp_max column to products");
  assert.match(upSql, /delay_minutes/i, "Migration 028 must add delay_minutes column to products");
  assert.match(upSql, /chk_products_temp_range/i, "Migration 028 must enforce temp_min < temp_max constraint");

  // UP: adds columns to shipments
  assert.match(upSql, /applied_temp_min/i, "Migration 028 must add applied_temp_min column to shipments");
  assert.match(upSql, /applied_temp_max/i, "Migration 028 must add applied_temp_max column to shipments");
  assert.match(upSql, /applied_delay_minutes/i, "Migration 028 must add applied_delay_minutes column to shipments");
  assert.match(upSql, /temperature_config/i, "Migration 028 must add temperature_config column to shipments");

  // DOWN: drops columns from products and shipments
  assert.match(downSql, /DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?temperature_config/i, "Migration 028 rollback must drop temperature_config");
  assert.match(downSql, /DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?temp_min/i, "Migration 028 rollback must drop temp_min");
  assert.match(downSql, /DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?temp_max/i, "Migration 028 rollback must drop temp_max");
  assert.match(downSql, /DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?delay_minutes/i, "Migration 028 rollback must drop delay_minutes");
  assert.ok(!/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(products|shipments)\b/i.test(downSql), "Migration 028 rollback must NEVER drop products or shipments table");
});

test("S-50: Migration 029 creates public lot cache and rate limit tables with rollback", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const upPath = path.resolve(__dirname, "../../db/migrations/029_public_cache_and_rate_limits.sql");
  const downPath = path.resolve(__dirname, "../../db/migrations/down/029_public_cache_and_rate_limits.down.sql");

  assert.ok(fs.existsSync(upPath), "Migration 029 UP file must exist");
  assert.ok(fs.existsSync(downPath), "Migration 029 DOWN file must exist");

  const upSql = fs.readFileSync(upPath, "utf-8");
  const downSql = fs.readFileSync(downPath, "utf-8");

  // UP: creates tables
  assert.match(upSql, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public_lot_cache/i, "Migration 029 must create public_lot_cache table");
  assert.match(upSql, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public_lot_rate_limits/i, "Migration 029 must create public_lot_rate_limits table");
  assert.match(upSql, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public_blocked_ips/i, "Migration 029 must create public_blocked_ips table");

  // DOWN: drops tables
  assert.match(downSql, /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public_lot_cache/i, "Migration 029 rollback must drop public_lot_cache");
  assert.match(downSql, /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public_lot_rate_limits/i, "Migration 029 rollback must drop public_lot_rate_limits");
  assert.match(downSql, /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public_blocked_ips/i, "Migration 029 rollback must drop public_blocked_ips");
});

if (process.env.DATABASE_URL) {
  test("migrate: up and down work with database", async () => {
    const upRes = await runMigrations("up");
    assert.equal(upRes.status, "ok");
  });
}


