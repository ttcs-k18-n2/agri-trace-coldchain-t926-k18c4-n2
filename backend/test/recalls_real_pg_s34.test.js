const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Pool } = require("pg");
const {
  app,
  setDatabasePool,
  verifyBatchIntegrity,
} = require("../src/server");
const { seedS39Postgres } = require("../scripts/seed_s39");

const isCI = process.env.CI === "true" || process.env.CI === "1";
const isDbRequired =
  isCI ||
  process.env.REQUIRE_DB === "true" ||
  process.env.REQUIRE_POSTGRES === "true" ||
  process.env.STRICT_POSTGRES === "true";

const isConfirmedDisposable = process.env.CONFIRMED_DISPOSABLE_DB === "true";

// Strictly require explicit URLs - no default fallback to local databases
const explicitTestUrl = process.env.TEST_DATABASE_URL;
const explicitTestMigUrl = process.env.TEST_MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;

const explicitNormalUrl = isCI ? process.env.DATABASE_URL : null;
const explicitNormalMigUrl = isCI ? (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL) : null;

const RUNTIME_DB_URL = explicitTestUrl || explicitNormalUrl;
const MIGRATION_DB_URL = explicitTestMigUrl || explicitNormalMigUrl;

function parseDatabaseName(urlString) {
  try {
    const u = new URL(urlString);
    const db = u.pathname.replace(/^\//, "").split("?")[0];
    return decodeURIComponent(db) || null;
  } catch {
    return null;
  }
}

test("Real PostgreSQL S-34 Acceptance Criteria Suite on agy_s34_test", async (t) => {
  // Pre-connection safety guard: require explicit disposable database configuration
  if (!isConfirmedDisposable || !RUNTIME_DB_URL || !MIGRATION_DB_URL) {
    const guardMsg =
      "[PG Test Safety Guard] Missing explicit disposable test database configuration. " +
      "Requires explicit TEST_DATABASE_URL/TEST_MIGRATION_DATABASE_URL (or CI with explicit DATABASE_URL/MIGRATION_DATABASE_URL) " +
      "AND CONFIRMED_DISPOSABLE_DB=true to protect shared/production environments.";
    if (isDbRequired) {
      assert.fail(`[REQUIRED-DB/CI FAILURE] ${guardMsg}`);
    }
    t.skip(guardMsg);
    return;
  }

  const expectedDbName = parseDatabaseName(RUNTIME_DB_URL);
  assert.ok(expectedDbName, `Could not parse target database name from URL: ${RUNTIME_DB_URL}`);

  let migPool = null;
  let appPool = null;
  try {
    migPool = new Pool({
      connectionString: MIGRATION_DB_URL,
      connectionTimeoutMillis: 5000,
    });
    appPool = new Pool({
      connectionString: RUNTIME_DB_URL,
      connectionTimeoutMillis: 5000,
    });

    const res = await appPool.query("SELECT current_database(), current_user");
    assert.equal(
      res.rows[0].current_database,
      expectedDbName,
      `Connected database (${res.rows[0].current_database}) must match URL database (${expectedDbName})`
    );
  } catch (err) {
    if (migPool) await migPool.end().catch(() => {});
    if (appPool) await appPool.end().catch(() => {});
    if (isDbRequired) {
      throw new Error(`REQUIRE_DB=true but failed to connect to ${expectedDbName}: ${err.message}`);
    }
    t.skip(`PostgreSQL ${expectedDbName} not reachable: ${err.message}`);
    return;
  }

  // Activate runtime pool on server
  setDatabasePool(appPool);

  async function loginAs(email, password = "Password@123") {
    const agent = request.agent(app);
    const loginRes = await agent.post("/api/login").send({ email, password });
    assert.equal(
      loginRes.status,
      200,
      `Login failed for ${email}: ${JSON.stringify(loginRes.body)}`
    );
    return agent;
  }

  // Seed S-39 stored oracle dataset in PostgreSQL using migration pool
  await seedS39Postgres(migPool);

  let createdRecallId = null;
  const rootLotId = "R01";
  const dynamicLotId = "R16";
  const dynamicRelId = "rel-s34-dyn-r16";

  try {
    // =========================================================================
    // AC 1: Authenticated Root Recall Creation + Event Chaining
    // =========================================================================
    await t.test("AC1: Authenticated Inspector opens root recall and appends cryptographic event in PostgreSQL", async () => {
      const inspectorAgent = await loginAs("inspector@example.com");

      const createRes = await inspectorAgent.post("/api/recalls").send({
        lotId: rootLotId,
        reason: "Phát hiện dư lượng thuốc BVTV vượt ngưỡng quy định",
        severity: "HIGH",
      });

      assert.equal(createRes.status, 201, `Failed to create recall: ${JSON.stringify(createRes.body)}`);
      assert.ok(createRes.body.recallOrder);
      createdRecallId = createRes.body.recallOrder.id;

      // Canonical string ID format REC-YYYYMMDD-XXXXXX
      assert.ok(typeof createdRecallId === "string");
      assert.match(createdRecallId, /^REC-\d{8}-[A-F0-9]{6}$/);
      assert.equal(createRes.body.recallOrder.lotId, rootLotId);
      assert.equal(createRes.body.recallOrder.status, "OPEN");
      assert.equal(createRes.body.recallOrder.severity, "HIGH");

      // Verify row in PostgreSQL recall_orders table
      const orderDb = await appPool.query(
        "SELECT id, lot_id, reason, severity, status, created_by FROM recall_orders WHERE id = $1",
        [createdRecallId]
      );
      assert.equal(orderDb.rowCount, 1, "recall_orders row must exist in PostgreSQL");
      assert.equal(orderDb.rows[0].status, "OPEN");
      assert.equal(orderDb.rows[0].lot_id, rootLotId);

      // Verify RECALL_ORDER_CREATED in batch_events table
      const eventDb = await appPool.query(
        "SELECT event_type, batch_id, payload, event_hash, previous_hash FROM batch_events WHERE batch_id = $1 AND event_type = 'RECALL_ORDER_CREATED'",
        [rootLotId]
      );
      assert.equal(eventDb.rowCount, 1, "batch_events must record RECALL_ORDER_CREATED in PostgreSQL");
      assert.equal(eventDb.rows[0].payload.recallOrderId, createdRecallId);

      // Verify cryptographic hash chain integrity in PostgreSQL
      const chainCheck = await verifyBatchIntegrity(appPool, rootLotId);
      assert.equal(chainCheck.valid, true, `Hash chain for root lot ${rootLotId} must be cryptographically valid: ${chainCheck.error}`);
    });

    // =========================================================================
    // AC 2: Authorized Root Update Only (Descendants status preserved in DB)
    // =========================================================================
    await t.test("AC2: Authorized root update only - root lot status updated to 'Có sự cố', descendants intact", async () => {
      // Root lot status in PostgreSQL lots table must be updated to 'Có sự cố'
      const rootDb = await appPool.query("SELECT id, status FROM lots WHERE id = $1", [rootLotId]);
      assert.equal(rootDb.rows[0].status, "Có sự cố", "Root lot status must be updated to 'Có sự cố'");

      // Descendants must NOT be mutated in the PostgreSQL database table
      const descDb = await appPool.query(
        "SELECT id, status FROM lots WHERE id IN ('R04', 'R05', 'R08', 'R09', 'R11', 'R12', 'R13') ORDER BY id"
      );
      const statusMap = Object.fromEntries(descDb.rows.map((r) => [r.id, r.status]));

      assert.equal(statusMap["R04"], "Đang chế biến", "R04 status must remain intact");
      assert.equal(statusMap["R05"], "Đang chế biến", "R05 status must remain intact");
      assert.equal(statusMap["R08"], "Đang chế biến", "R08 status must remain intact");
      assert.equal(statusMap["R09"], "Đã nhập kho", "R09 status must remain intact");
      assert.equal(statusMap["R11"], "Đã bán hết", "R11 status must remain 'Đã bán hết'");
      assert.equal(statusMap["R12"], "Đang lưu kho", "R12 status must remain 'Đang lưu kho'");
      assert.equal(statusMap["R13"], "Đang lưu kho", "R13 status must remain 'Đang lưu kho'");
    });

    // =========================================================================
    // AC 3: Canonical String ID Across Schema and Endpoints
    // =========================================================================
    await t.test("AC3: Canonical String IDs across PostgreSQL schema and recall endpoints", async () => {
      const inspectorAgent = await loginAs("inspector@example.com");

      // Verify column type in information_schema
      const colRes = await appPool.query(
        `SELECT table_name, column_name, data_type, character_maximum_length
         FROM information_schema.columns
         WHERE table_name = 'recall_orders' AND column_name = 'id'`
      );
      assert.equal(colRes.rowCount, 1);
      assert.equal(colRes.rows[0].data_type, "character varying");
      assert.equal(colRes.rows[0].character_maximum_length, 64);

      // Lookup via GET /api/recalls/:id
      const getRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.recallOrder.id, createdRecallId);
      assert.equal(getRes.body.recallOrder.lotId, rootLotId);
    });

    // =========================================================================
    // AC 4: Tenant & Role Denials (RBAC Enforcement)
    // =========================================================================
    await t.test("AC4: Role and tenant denials - non-inspector roles blocked, unauthenticated blocked, non-existent lot 404", async () => {
      const producerAgent = await loginAs("user@example.com");
      const unauthAgent = request.agent(app);

      // Role denial: Producer cannot create recall orders
      const forbiddenPost = await producerAgent.post("/api/recalls").send({
        lotId: rootLotId,
        reason: "Producer trying to open recall",
        severity: "HIGH",
      });
      assert.equal(forbiddenPost.status, 403, "Producer role must be denied POST /api/recalls with 403");

      // Role denial: Producer cannot view recall detail
      const forbiddenGet = await producerAgent.get(`/api/recalls/${createdRecallId}`);
      assert.equal(forbiddenGet.status, 403, "Producer role must be denied GET /api/recalls/:id with 403");

      // Role denial: Producer cannot view descendants
      const forbiddenDesc = await producerAgent.get(`/api/recalls/${createdRecallId}/descendants`);
      assert.equal(forbiddenDesc.status, 403, "Producer role must be denied GET /api/recalls/:id/descendants with 403");

      // Unauthenticated access blocked with 401
      const unauthPost = await unauthAgent.post("/api/recalls").send({
        lotId: rootLotId,
        reason: "Unauth attempt",
      });
      assert.equal(unauthPost.status, 401, "Unauthenticated POST must return 401");

      const unauthGet = await unauthAgent.get(`/api/recalls/${createdRecallId}`);
      assert.equal(unauthGet.status, 401, "Unauthenticated GET must return 401");

      // Non-existent lot lookup returns 404
      const inspectorAgent = await loginAs("inspector@example.com");
      const notFoundPost = await inspectorAgent.post("/api/recalls").send({
        lotId: "LOT-NON-EXISTENT",
        reason: "Thử mã lô không tồn tại",
        severity: "HIGH",
      });
      assert.equal(notFoundPost.status, 404);
      assert.equal(notFoundPost.body.error, "LOT_NOT_FOUND");

      // Inspector may open recall via explicit scoped exception, but CANNOT write shipments or other routes
      const inspectorShipmentPost = await inspectorAgent.post("/api/shipments").send({
        lotIds: [rootLotId],
        coldBoxId: "BOX-TEST-INSPECTOR",
      });
      assert.equal(inspectorShipmentPost.status, 403, "Inspector must be denied POST /api/shipments with 403");

      const inspectorCoordPatch = await inspectorAgent.patch(`/api/lots/${rootLotId}/coordinates`).send({
        coordinates: "21.5750, 105.6905",
      });
      assert.equal(inspectorCoordPatch.status, 403, "Inspector must be denied PATCH /api/lots/:id/coordinates with 403");

      // Cross-tenant denial: Producer (org-001) cannot update cross-tenant lot R04 (ORG-B)
      const crossTenantPatch = await producerAgent.patch("/api/lots/R04/coordinates").send({
        coordinates: "21.5750, 105.6905",
      });
      assert.equal(crossTenantPatch.status, 403, "Producer cannot modify cross-tenant lot R04 (ORG-B)");
    });

    // =========================================================================
    // AC 5: Four-Level, Three-Org Descendant Graph Matching S-39 Stored Oracle
    // =========================================================================
    await t.test("AC5: Four-level, three-org descendant graph matches S-39 stored oracle (7 descendants, multi-source merge R08, 730kg)", async () => {
      const inspectorAgent = await loginAs("inspector@example.com");

      const descRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
      assert.equal(descRes.status, 200);

      const body = descRes.body;
      assert.equal(body.recallId, createdRecallId);
      assert.equal(body.rootLotId, rootLotId);

      // Verify exactly 7 descendants matching S-39 manual audit oracle
      const expectedIds = ["R04", "R05", "R08", "R09", "R11", "R12", "R13"];
      assert.equal(body.descendantCount, 7, "Must have exactly 7 descendant lots");
      assert.deepEqual(
        [...body.descendantIds].sort(),
        [...expectedIds].sort(),
        "Descendant IDs must match S-39 oracle exactly"
      );

      // Verify 3 distinct organizations across 4 levels: ORG-A (root), ORG-B (R04, R05, R08), ORG-C (R09, R11, R12, R13)
      const descOrgs = new Set(body.descendants.map((d) => d.organizationId || d.organization_id));
      assert.ok(descOrgs.has("ORG-B"), "Descendants must include ORG-B");
      assert.ok(descOrgs.has("ORG-C"), "Descendants must include ORG-C");

      // Verify multi-source merge on R08 (merged from R04 and R06)
      const r08 = body.descendants.find((d) => d.id === "R08");
      assert.ok(r08, "R08 must be in descendants");
      assert.equal(r08.isMultiSourceMerge, true, "R08 must be flagged with isMultiSourceMerge = true");
      assert.equal(r08.sourcesCount, 2, "R08 must indicate 2 parent sources");
      assert.equal(r08.notes, "Lô gộp từ nhiều nguồn");
      assert.ok(Array.isArray(r08.mergedSources));
      const r08ParentIds = r08.mergedSources.map((s) => s.parentBatchId);
      assert.ok(r08ParentIds.includes("R04"), "Parent 1 must be R04");
      assert.ok(r08ParentIds.includes("R06"), "Parent 2 must be R06");

      // Verify total recall quantity: 150 (R04) + 100 (R05) + 100 (R08) + 100 (R09) + 200 (R12) + 80 (R13) = 730 kg
      assert.equal(body.totalRecallQuantity, 730, "Total quarantine quantity must be exactly 730 kg");

      // Verify consumed lot: R11 (remainingQuantity = 0, status = 'Đã bán hết')
      const r11 = body.descendants.find((d) => d.id === "R11");
      assert.ok(r11, "R11 must be in descendants");
      assert.equal(r11.status, "Đã bán hết");
      assert.equal(Number(r11.remainingQuantity), 0);

      assert.ok(Array.isArray(body.consumedLots), "consumedLots must be an array");
      assert.equal(body.consumedLots.length, 1);
      assert.equal(body.consumedLots[0].id, "R11");
    });

    // =========================================================================
    // AC 6: Dynamic Real-time Graph Mutation (New Child after Recall Open)
    // =========================================================================
    await t.test("AC6: Real-time dynamic BFS - newly added split child in PostgreSQL dynamically appears without modifying recall order", async () => {
      const inspectorAgent = await loginAs("inspector@example.com");

      // Dynamically split R12 into R16 (50kg) directly in PostgreSQL
      await migPool.query(
        `INSERT INTO lots (id, name, status, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at, parent_lot_id, created_at)
         VALUES ($1, 'Lô Cà chua Tách Mới R16', 'Đang lưu kho', 'ORG-C', NULL, 'PROD-TOMATO', 50.000, 50.000, '2026-10-06', 'R12', NOW())
         ON CONFLICT (id) DO UPDATE SET remaining_quantity = 50.000`,
        [dynamicLotId]
      );
      await migPool.query(
        `INSERT INTO batch_relations (id, parent_batch_id, child_batch_id, relation_type, quantity, organization_id)
         VALUES ($1, 'R12', $2, 'SPLIT', 50.000, 'ORG-C')
         ON CONFLICT (id) DO NOTHING`,
        [dynamicRelId, dynamicLotId]
      );
      // Reduce R12 remaining quantity in PostgreSQL: 200 -> 150
      await migPool.query("UPDATE lots SET remaining_quantity = 150.000 WHERE id = 'R12'");

      // Re-query descendants via API - MUST dynamically discover R16
      const dynamicRes = await inspectorAgent.get(`/api/recalls/${createdRecallId}/descendants`);
      assert.equal(dynamicRes.status, 200);

      assert.equal(
        dynamicRes.body.descendantCount,
        8,
        "Descendant count must dynamically increase from 7 to 8 via real-time BFS"
      );
      assert.ok(
        dynamicRes.body.descendantIds.includes(dynamicLotId),
        "Descendants must dynamically include new child R16"
      );

      const r16InDesc = dynamicRes.body.descendants.find((d) => d.id === dynamicLotId);
      assert.ok(r16InDesc);
      assert.equal(Number(r16InDesc.remainingQuantity), 50);
      assert.equal(r16InDesc.parentLotId, "R12");

      // Total quantity is preserved: (150+100+100+100+150+50+80) = 730 kg
      assert.equal(dynamicRes.body.totalRecallQuantity, 730, "Total quantity must remain 730 kg");
    });
  } finally {
    // Teardown test artifacts in PostgreSQL
    if (migPool) {
      await migPool.query("DELETE FROM batch_relations WHERE id = $1", [dynamicRelId]).catch(() => {});
      await migPool.query("DELETE FROM lots WHERE id = $1", [dynamicLotId]).catch(() => {});
      await migPool.query("UPDATE lots SET remaining_quantity = 200.000, status = 'Đã thu hoạch' WHERE id = 'R01'").catch(() => {});
      await migPool.query("UPDATE lots SET remaining_quantity = 200.000 WHERE id = 'R12'").catch(() => {});
      if (createdRecallId) {
        await migPool.query("DELETE FROM recall_orders WHERE id = $1", [createdRecallId]).catch(() => {});
        await migPool.query("DELETE FROM batch_events WHERE batch_id = $1 AND event_type = 'RECALL_ORDER_CREATED'", [rootLotId]).catch(() => {});
      }
    }

    setDatabasePool(null);
    if (appPool) await appPool.end().catch(() => {});
    if (migPool) await migPool.end().catch(() => {});
  }
});
