const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const request = require("supertest");
const { app } = require("../src/server");
const { GENESIS_HASH, calculateEventHash } = require("../src/integrity");

const APP_DB_URL =
  process.env.DATABASE_URL || "postgresql://agri_app:app_password@localhost:5432/agri_trace";
const MIGRATION_DB_URL =
  process.env.MIGRATION_DATABASE_URL || "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";

let appDb;
let migrationDb;
let isPostgresAvailable = false;

test.before(async () => {
  try {
    migrationDb = new Pool({ connectionString: MIGRATION_DB_URL, connectionTimeoutMillis: 3000 });
    await migrationDb.query("SELECT 1;");
    appDb = new Pool({ connectionString: APP_DB_URL, connectionTimeoutMillis: 3000 });
    await appDb.query("SELECT 1;");
    isPostgresAvailable = true;
  } catch (err) {
    console.warn("[Append-Only Test] PostgreSQL not reachable:", err.message);
    isPostgresAvailable = false;
  }
});

test.after(async () => {
  if (appDb) await appDb.end();
  if (migrationDb) await migrationDb.end();
});

test("S-11 Architecture: Backend exposes NO PUT, PATCH, or DELETE routes on /events", async () => {
  // Check HTTP methods
  const agent = request(app);

  const putRes = await agent.put("/api/lots/LOT-001/events").send({ eventType: "HACK" });
  assert.equal(putRes.status, 404, "PUT /api/lots/:id/events must not exist");

  const patchRes = await agent.patch("/api/lots/LOT-001/events").send({ eventType: "HACK" });
  assert.equal(patchRes.status, 404, "PATCH /api/lots/:id/events must not exist");

  const deleteRes = await agent.delete("/api/lots/LOT-001/events");
  assert.equal(deleteRes.status, 404, "DELETE /api/lots/:id/events must not exist");

  const putEventRes = await agent.put("/api/events/EVT-001").send({ eventType: "HACK" });
  assert.equal(putEventRes.status, 404, "PUT /api/events/:id must not exist");

  const deleteEventRes = await agent.delete("/api/events/EVT-001");
  assert.equal(deleteEventRes.status, 404, "DELETE /api/events/:id must not exist");
});

test("S-11 Database Privileges: agri_app can INSERT but CANNOT UPDATE, DELETE, or TRUNCATE batch_events", async (t) => {
  if (!isPostgresAvailable) {
    t.skip("PostgreSQL not reachable, skipping live permission test");
    return;
  }

  // 0. Verify CURRENT_USER roles for both pools (S-11)
  const appUserCheck = await appDb.query("SELECT CURRENT_USER AS db_user;");
  assert.equal(appUserCheck.rows[0].db_user, "agri_app", "Application database pool must connect strictly as agri_app");

  const migrationUserCheck = await migrationDb.query("SELECT CURRENT_USER AS db_user;");
  assert.equal(migrationUserCheck.rows[0].db_user, "agri_migration", "Migration database pool must connect strictly as agri_migration");

  const testBatchId = `LOT-TEST-APPEND-${Date.now().toString(36).toUpperCase()}`;
  const testEventId = `EVT-TEST-${Date.now().toString(36).toUpperCase()}`;

  // 1. Setup a test lot using migration user
  await migrationDb.query(`
    INSERT INTO lots (id, name, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at)
    VALUES ($1, 'Append Only Lot', 'org-001', 'FARM-001', 'PROD-TEA', 10, 10, '2026-10-04')
    ON CONFLICT (id) DO NOTHING;
  `, [testBatchId]);

  t.after(async () => {
    try {
      await migrationDb.query("DELETE FROM batch_events WHERE batch_id = $1", [testBatchId]);
      await migrationDb.query("DELETE FROM lots WHERE id = $1", [testBatchId]);
    } catch {
      // cleanup best effort
    }
  });

  const occurredAt = new Date().toISOString();
  const eventPayload = { farmId: "FARM-001", quantity: 10 };
  const eventHash = calculateEventHash(GENESIS_HASH, {
    batchId: testBatchId,
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    payload: eventPayload,
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt,
  });

  // 2. agri_app CAN INSERT into batch_events
  await assert.doesNotReject(async () => {
    await appDb.query(`
      INSERT INTO batch_events (
        id, batch_id, sequence_no, event_type, payload,
        organization_id, actor_user_id, occurred_at,
        previous_hash, event_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      testEventId,
      testBatchId,
      1,
      "HARVEST_CREATED",
      JSON.stringify(eventPayload),
      "org-001",
      "usr-001",
      occurredAt,
      GENESIS_HASH,
      eventHash,
    ]);
  }, "agri_app must be permitted to INSERT into batch_events");

  // 3. agri_app CAN SELECT from batch_events
  const selectRes = await appDb.query(
    "SELECT id, event_type FROM batch_events WHERE id = $1",
    [testEventId]
  );
  assert.equal(selectRes.rows.length, 1);
  assert.equal(selectRes.rows[0].event_type, "HARVEST_CREATED");

  // 4. agri_app CANNOT UPDATE batch_events (permission denied)
  await assert.rejects(
    async () => {
      await appDb.query(
        "UPDATE batch_events SET event_type = 'HACK' WHERE id = $1",
        [testEventId]
      );
    },
    (err) => {
      assert.match(
        err.message,
        /permission denied for (table|relation) batch_events/i,
        `Expected permission denied error but got: ${err.message}`
      );
      return true;
    },
    "agri_app must NOT be able to UPDATE batch_events"
  );

  // 5. agri_app CANNOT DELETE from batch_events (permission denied)
  await assert.rejects(
    async () => {
      await appDb.query(
        "DELETE FROM batch_events WHERE id = $1",
        [testEventId]
      );
    },
    (err) => {
      assert.match(
        err.message,
        /permission denied for (table|relation) batch_events/i,
        `Expected permission denied error but got: ${err.message}`
      );
      return true;
    },
    "agri_app must NOT be able to DELETE from batch_events"
  );

  // 6. agri_app CANNOT TRUNCATE batch_events (permission denied)
  await assert.rejects(
    async () => {
      await appDb.query("TRUNCATE batch_events");
    },
    (err) => {
      assert.match(
        err.message,
        /permission denied for (table|relation) batch_events/i,
        `Expected permission denied error but got: ${err.message}`
      );
      return true;
    },
    "agri_app must NOT be able to TRUNCATE batch_events"
  );
});
