const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Pool } = require("pg");
const {
  app,
  seedDemoUser,
  setDatabasePool,
  inMemoryShipments,
  recordShipmentTemperature,
  getShipments,
  getShipmentById,
} = require("../src/server");

const isCI = process.env.CI === "true" || process.env.CI === "1";
const isDbRequired =
  isCI ||
  process.env.REQUIRE_DB === "true" ||
  process.env.REQUIRE_POSTGRES === "true" ||
  process.env.STRICT_POSTGRES === "true";

const isDisposableDbConfirmed =
  isCI ||
  Boolean(process.env.TEST_DATABASE_URL) ||
  process.env.CONFIRMED_DISPOSABLE_DB === "true";

// Dedicated database URL strictly for S-41 backend testing
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://agri_app:app_password@127.0.0.1:60358/agy_s41_backend_test";
const MIGRATION_DATABASE_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ||
  process.env.MIGRATION_DATABASE_URL ||
  "postgresql://agri_migration:migration_password@127.0.0.1:60358/agy_s41_backend_test";

// Guard: prevent touching other databases
function assertSafeDatabaseTarget(url) {
  if (!url) return;
  const prohibitedDbs = ["agy_campaign_test", "agy_recall_test", "agy_s34_test", "agri_trace_prod", "agri_trace_live"];
  for (const forbidden of prohibitedDbs) {
    if (url.includes(forbidden)) {
      throw new Error(`[SAFETY GUARD VIOLATION] Test attempted to connect to prohibited database '${forbidden}': ${url}`);
    }
  }
}

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function loginUser(server, email, password) {
  const res = await request(
    server,
    {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  );
  return res.headers["set-cookie"] ? res.headers["set-cookie"][0].split(";")[0] : null;
}

test("S-41 PostgreSQL Integration Suite (Story S-41 / Jira N2-109)", async (t) => {
  assertSafeDatabaseTarget(DATABASE_URL);
  assertSafeDatabaseTarget(MIGRATION_DATABASE_URL);

  let pool = null;
  let migrationPool = null;
  let isPostgresAvailable = false;
  let dbConnectionError = null;

  if (isDisposableDbConfirmed) {
    try {
      migrationPool = new Pool({ connectionString: MIGRATION_DATABASE_URL, connectionTimeoutMillis: 3000 });
      pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
      await pool.query("SELECT 1;");
      isPostgresAvailable = true;
      setDatabasePool(pool);
    } catch (err) {
      dbConnectionError = err.message || err.code || String(err);
      isPostgresAvailable = false;
    }
  }

  t.after(async () => {
    if (pool) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
    }
    if (migrationPool) {
      try {
        await migrationPool.end();
      } catch {
        /* ignore */
      }
    }
    setDatabasePool(null);
  });

  if (!isPostgresAvailable) {
    if (isDbRequired) {
      assert.fail(`[REQUIRED-DB/CI FAILURE] PostgreSQL is required but could not connect: ${dbConnectionError}`);
    }
    console.log(
      `[SKIP PG SUITE] PostgreSQL test database không khả dụng (${dbConnectionError || "no disposable DB configured"}). Bỏ qua suite PostgreSQL.`
    );
  }

  // --- SUBTEST 1: Schema UP/DOWN Preserving S-40 Base Data (Only runs when PostgreSQL is available) ---
  await t.test(
    "TC-S41-PG-01: Schema UP/DOWN migration preserving S-40 baseline shipment data",
    { skip: !isPostgresAvailable },
    async () => {
      // 1. Ensure baseline S40 schema exists
      await migrationPool.query(`
        CREATE TABLE IF NOT EXISTS organizations (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS shipments (
          id VARCHAR(50) PRIMARY KEY,
          cold_box_id VARCHAR(50) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'IN_TRANSIT',
          organization_id VARCHAR(50) NOT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 2. Run Migration 026 UP
      await migrationPool.query(`
        CREATE TABLE IF NOT EXISTS shipment_temperatures (
            id VARCHAR(50) PRIMARY KEY DEFAULT ('temp-' || substr(md5(random()::text), 1, 8)),
            shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
            cold_box_id VARCHAR(50) NOT NULL,
            temperature NUMERIC(5, 2) NOT NULL,
            recorded_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_shipment_temperature_timestamp UNIQUE (shipment_id, recorded_at)
        );
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS current_temperature NUMERIC(5, 2);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_temperature_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_shipment ON shipment_temperatures(shipment_id);
      `);

      // Seed baseline S40 shipment
      const testOrgId = "org-s41-pg-test";
      const testShipId = "shp-s41-pg-preserve-01";
      await pool.query(
        "INSERT INTO organizations (id, name, type) VALUES ($1, $2, 'transporter') ON CONFLICT (id) DO NOTHING",
        [testOrgId, "Tổ chức thử nghiệm S41"]
      );
      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW())
         ON CONFLICT (id) DO UPDATE SET cold_box_id = EXCLUDED.cold_box_id`,
        [testShipId, "CB-PRESERVE-01", testOrgId]
      );

      // Record a temperature
      await pool.query(
        `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at)
         VALUES ('temp-test-01', $1, 'CB-PRESERVE-01', 4.5, NOW())`,
        [testShipId]
      );

      // 3. Run Migration 026 DOWN
      await migrationPool.query(`
        DROP TABLE IF EXISTS shipment_temperatures CASCADE;
        ALTER TABLE shipments DROP COLUMN IF EXISTS current_temperature;
        ALTER TABLE shipments DROP COLUMN IF EXISTS last_temperature_at;
      `);

      // Verify S40 core shipment still exists intact
      const shipCheck = await pool.query("SELECT id, cold_box_id, status FROM shipments WHERE id = $1", [testShipId]);
      assert.equal(shipCheck.rows.length, 1);
      assert.equal(shipCheck.rows[0].cold_box_id, "CB-PRESERVE-01");

      // 4. Re-apply Migration 026 UP for the rest of tests
      await migrationPool.query(`
        CREATE TABLE IF NOT EXISTS shipment_temperatures (
            id VARCHAR(50) PRIMARY KEY DEFAULT ('temp-' || substr(md5(random()::text), 1, 8)),
            shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
            cold_box_id VARCHAR(50) NOT NULL,
            temperature NUMERIC(5, 2) NOT NULL,
            recorded_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_shipment_temperature_timestamp UNIQUE (shipment_id, recorded_at)
        );
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS current_temperature NUMERIC(5, 2);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_temperature_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_shipment ON shipment_temperatures(shipment_id);
      `);
    }
  );

  // --- SUBTEST 2: Real PostgreSQL Ingestion & Atomicity ---
  await t.test(
    "TC-S41-PG-02: Real PostgreSQL temperature ingestion, row locking, and atomic updates",
    { skip: !isPostgresAvailable },
    async () => {
      const orgId = "org-s41-pg-test";
      const shipId = "shp-s41-pg-ingest-01";
      const coldBoxId = "CB-PG-INGEST-01";

      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET status = 'IN_TRANSIT', current_temperature = NULL, last_temperature_at = NULL, started_at = NOW() - INTERVAL '1 day'`,
        [shipId, coldBoxId, orgId]
      );
      await pool.query("DELETE FROM shipment_temperatures WHERE shipment_id = $1", [shipId]);

      const authContext = { userId: "usr-s41-trans", organizationId: orgId, roleId: "transporter" };
      const time1 = new Date("2026-10-17T12:00:00.000Z").toISOString();

      // Normal ingestion
      const res1 = await recordShipmentTemperature({
        pool,
        authContext,
        data: { coldBoxId, temperature: 3.8, timestamp: time1 },
      });
      assert.equal(res1.status, 200);
      assert.equal(res1.acknowledged, true);
      assert.equal(res1.ignored, false);

      // Verify database state
      const dbShip1 = await pool.query("SELECT current_temperature, last_temperature_at FROM shipments WHERE id = $1", [shipId]);
      assert.equal(Number(dbShip1.rows[0].current_temperature), 3.8);
      assert.equal(new Date(dbShip1.rows[0].last_temperature_at).toISOString(), time1);

      // Duplicate timestamp: must be idempotent and ignored
      const resDup = await recordShipmentTemperature({
        pool,
        authContext,
        data: { coldBoxId, temperature: 3.8, timestamp: time1 },
      });
      assert.equal(resDup.status, 200);
      assert.equal(resDup.acknowledged, true);
      assert.equal(resDup.ignored, true);

      // Out-of-order older reading: must be ignored, current reading preserved
      const timeOlder = new Date("2026-10-17T11:30:00.000Z").toISOString();
      const resOlder = await recordShipmentTemperature({
        pool,
        authContext,
        data: { coldBoxId, temperature: 5.0, timestamp: timeOlder },
      });
      assert.equal(resOlder.status, 200);
      assert.equal(resOlder.acknowledged, true);
      assert.equal(resOlder.ignored, true);

      const dbShipAfterOlder = await pool.query("SELECT current_temperature, last_temperature_at FROM shipments WHERE id = $1", [shipId]);
      assert.equal(Number(dbShipAfterOlder.rows[0].current_temperature), 3.8);
      assert.equal(new Date(dbShipAfterOlder.rows[0].last_temperature_at).toISOString(), time1);

      // Newer reading: must update current reading
      const timeNewer = new Date("2026-10-17T12:15:00.000Z").toISOString();
      const resNewer = await recordShipmentTemperature({
        pool,
        authContext,
        data: { coldBoxId, temperature: 4.1, timestamp: timeNewer },
      });
      assert.equal(resNewer.status, 200);
      assert.equal(resNewer.ignored, false);

      const dbShipAfterNewer = await pool.query("SELECT current_temperature, last_temperature_at FROM shipments WHERE id = $1", [shipId]);
      assert.equal(Number(dbShipAfterNewer.rows[0].current_temperature), 4.1);
      assert.equal(new Date(dbShipAfterNewer.rows[0].last_temperature_at).toISOString(), timeNewer);
    }
  );

  // --- SUBTEST 3: Concurrent connections and lifecycle race with shipment completion ---
  await t.test(
    "TC-S41-PG-03: Concurrent submissions race and lifecycle race with shipment completion",
    { skip: !isPostgresAvailable },
    async () => {
      const orgId = "org-s41-pg-test";
      const shipId = "shp-s41-pg-race-01";
      const coldBoxId = "CB-PG-RACE-01";

      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET status = 'IN_TRANSIT', current_temperature = NULL, last_temperature_at = NULL, started_at = NOW() - INTERVAL '1 day'`,
        [shipId, coldBoxId, orgId]
      );
      await pool.query("DELETE FROM shipment_temperatures WHERE shipment_id = $1", [shipId]);

      const authContext = { userId: "usr-s41-trans", organizationId: orgId, roleId: "transporter" };

      // 5 concurrent submissions with out-of-order timestamps
      const timestamps = [
        "2026-10-17T12:05:00.000Z",
        "2026-10-17T12:20:00.000Z", // latest
        "2026-10-17T12:10:00.000Z",
        "2026-10-17T12:15:00.000Z",
        "2026-10-17T12:08:00.000Z",
      ];

      const promises = timestamps.map((ts, idx) =>
        recordShipmentTemperature({
          pool,
          authContext,
          data: { coldBoxId, temperature: 3.0 + idx * 0.2, timestamp: ts },
        })
      );

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.equal(r.status, 200);
        assert.equal(r.acknowledged, true);
      }

      // Verify the latest timestamp wins on the shipments table
      const dbShip = await pool.query("SELECT current_temperature, last_temperature_at FROM shipments WHERE id = $1", [shipId]);
      assert.equal(new Date(dbShip.rows[0].last_temperature_at).toISOString(), "2026-10-17T12:20:00.000Z");

      // Lifecycle race: Complete shipment then attempt to record temperature
      await pool.query("UPDATE shipments SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1", [shipId]);

      const resAfterComplete = await recordShipmentTemperature({
        pool,
        authContext,
        data: { coldBoxId, temperature: 4.0, timestamp: "2026-10-17T12:25:00.000Z" },
      });
      assert.equal(resAfterComplete.status, 400);
      assert.equal(resAfterComplete.error, "SHIPMENT_ALREADY_ENDED");
    }
  );

  // --- SUBTEST 4: Rollback and Unique Constraint Violation ---
  await t.test(
    "TC-S41-PG-04: Transaction rollback and direct unique constraint enforcement",
    { skip: !isPostgresAvailable },
    async () => {
      const client = await pool.connect();
      const shipId = "shp-s41-pg-ingest-01";
      const ts = "2026-10-17T13:00:00.000Z";

      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at)
           VALUES ('temp-rb-test', $1, 'CB-PG-INGEST-01', 2.5, $2)`,
          [shipId, ts]
        );
        // Force Rollback
        await client.query("ROLLBACK");

        // Verify row was NOT persisted
        const check = await pool.query("SELECT 1 FROM shipment_temperatures WHERE id = 'temp-rb-test'");
        assert.equal(check.rows.length, 0);

        // Verify unique constraint throws 23505 on duplicate insertion
        await pool.query(
          `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at)
           VALUES ('temp-uq-1', $1, 'CB-PG-INGEST-01', 2.5, $2)`,
          [shipId, ts]
        );

        let errCode = null;
        try {
          await pool.query(
            `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at)
             VALUES ('temp-uq-2', $1, 'CB-PG-INGEST-01', 3.0, $2)`,
            [shipId, ts]
          );
        } catch (err) {
          errCode = err.code;
        }
        assert.equal(errCode, "23505", "Must throw PostgreSQL unique_violation (23505) on duplicate (shipment_id, recorded_at)");
      } finally {
        client.release();
      }
    }
  );

  // --- SUBTEST 5: Cold Box Reuse & Delayed Packet Pollution Defense ---
  await t.test(
    "TC-S41-PG-05: Real PostgreSQL cold box reuse delayed packet protection and numeric bounds",
    { skip: !isPostgresAvailable },
    async () => {
      const client = await pool.connect();
      const coldBox = "CB-PG-REUSE-01";
      const orgId = "org-trans";
      const authContext = { userId: "usr-trans", roleId: "transporter", organizationId: orgId };

      try {
        // Complete shipment A
        const shipAId = "shp-pg-reuse-a";
        await pool.query(
          `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at, completed_at, created_at, updated_at)
           VALUES ($1, $2, 'COMPLETED', $3, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
           ON CONFLICT (id) DO NOTHING`,
          [shipAId, coldBox, orgId]
        );

        // Start shipment B
        const shipBId = "shp-pg-reuse-b";
        await pool.query(
          `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at, created_at, updated_at)
           VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes')
           ON CONFLICT (id) DO NOTHING`,
          [shipBId, coldBox, orgId]
        );

        // Delayed packet from A (30 minutes ago, before B started 10 minutes ago)
        const delayedRes = await recordShipmentTemperature({
          pool,
          authContext,
          data: {
            coldBoxId: coldBox,
            temperature: 8.5,
            timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          },
        });
        assert.equal(delayedRes.status, 200);
        assert.equal(delayedRes.acknowledged, true);
        assert.equal(delayedRes.ignored, true);

        // Verify B's current_temperature is STILL NULL and no rows inserted for B
        const bCheck = await pool.query("SELECT current_temperature, last_temperature_at FROM shipments WHERE id = $1", [shipBId]);
        assert.equal(bCheck.rows[0].current_temperature, null);
        assert.equal(bCheck.rows[0].last_temperature_at, null);

        // Numeric overflow check: 1000.0 returns 400 instead of PG numeric overflow 500
        const overflowRes = await recordShipmentTemperature({
          pool,
          authContext,
          data: {
            coldBoxId: coldBox,
            temperature: 1000.0,
            timestamp: new Date().toISOString(),
          },
        });
        assert.equal(overflowRes.status, 400);
        assert.equal(overflowRes.error, "INVALID_TEMPERATURE");
      } finally {
        client.release();
      }
    }
  );

  // --- SUBTEST 6: Projection Consistency between getShipments and getShipmentById (0, negative, null) ---
  await t.test(
    "TC-S41-PG-06: getShipments PG projection preserving 0, negative temperature, ISO timestamp, and null",
    { skip: !isPostgresAvailable },
    async () => {
      const orgId = "org-trans";
      const authAdmin = { userId: "usr-admin", roleId: "admin" };

      // 1. Shipment with 0 degrees Celsius
      const shipZeroId = "shp-pg-zero-01";
      const coldBoxZero = "CB-PG-ZERO";
      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET current_temperature = NULL, last_temperature_at = NULL, started_at = NOW() - INTERVAL '1 day'`,
        [shipZeroId, coldBoxZero, orgId]
      );
      const timeZero = new Date("2026-10-17T12:00:00.000Z").toISOString();
      await recordShipmentTemperature({
        pool,
        authContext: { userId: "usr-trans", roleId: "transporter", organizationId: orgId },
        data: { coldBoxId: coldBoxZero, temperature: 0.0, timestamp: timeZero },
      });

      // 2. Shipment with negative temperature
      const shipNegId = "shp-pg-neg-01";
      const coldBoxNeg = "CB-PG-NEG";
      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET current_temperature = NULL, last_temperature_at = NULL, started_at = NOW() - INTERVAL '1 day'`,
        [shipNegId, coldBoxNeg, orgId]
      );
      const timeNeg = new Date("2026-10-17T12:05:00.000Z").toISOString();
      await recordShipmentTemperature({
        pool,
        authContext: { userId: "usr-trans", roleId: "transporter", organizationId: orgId },
        data: { coldBoxId: coldBoxNeg, temperature: -4.5, timestamp: timeNeg },
      });

      // 3. Shipment with no temperature recorded
      const shipNullId = "shp-pg-null-01";
      const coldBoxNull = "CB-PG-NULL";
      await pool.query(
        `INSERT INTO shipments (id, cold_box_id, status, organization_id, started_at)
         VALUES ($1, $2, 'IN_TRANSIT', $3, NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET current_temperature = NULL, last_temperature_at = NULL, started_at = NOW() - INTERVAL '1 day'`,
        [shipNullId, coldBoxNull, orgId]
      );

      // Verify list projection
      const listRes = await getShipments({ pool, authContext: authAdmin });
      assert.equal(listRes.success, true);
      const listMap = new Map(listRes.data.map((s) => [s.id, s]));

      // Verify detail projection
      const detailZero = await getShipmentById({ pool, authContext: authAdmin, shipmentId: shipZeroId });
      const detailNeg = await getShipmentById({ pool, authContext: authAdmin, shipmentId: shipNegId });
      const detailNull = await getShipmentById({ pool, authContext: authAdmin, shipmentId: shipNullId });

      // Compare Zero
      const listZero = listMap.get(shipZeroId);
      assert.ok(listZero, "Zero shipment must exist in getShipments list");
      assert.strictEqual(listZero.currentTemperature, 0, "List currentTemperature must preserve 0");
      assert.strictEqual(detailZero.shipment.currentTemperature, 0, "Detail currentTemperature must preserve 0");
      assert.equal(listZero.lastTemperatureAt, timeZero);
      assert.equal(detailZero.shipment.lastTemperatureAt, timeZero);

      // Compare Negative
      const listNeg = listMap.get(shipNegId);
      assert.ok(listNeg, "Negative shipment must exist in getShipments list");
      assert.strictEqual(listNeg.currentTemperature, -4.5);
      assert.strictEqual(detailNeg.shipment.currentTemperature, -4.5);
      assert.equal(listNeg.lastTemperatureAt, timeNeg);
      assert.equal(detailNeg.shipment.lastTemperatureAt, timeNeg);

      // Compare Null
      const listNull = listMap.get(shipNullId);
      assert.ok(listNull, "Null shipment must exist in getShipments list");
      assert.strictEqual(listNull.currentTemperature, null);
      assert.strictEqual(detailNull.shipment.currentTemperature, null);
      assert.strictEqual(listNull.lastTemperatureAt, null);
      assert.strictEqual(detailNull.shipment.lastTemperatureAt, null);
    }
  );
});

// =========================================================================
// PORTABLE LOGIC VERIFICATION SUITE (Always runs, zero DB required)
// Validates finite numbers, canonical cold-box resolution, session tenant/body spoof,
// active vs completed shipment, and out-of-order rejection logic deterministically.
// =========================================================================

test("S-41 Portable Logic Verification Suite (In-Memory & HTTP Endpoints)", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    return new Promise((resolve) => server.close(resolve));
  });

  const transporterCookie = await loginUser(server, "transporter@example.com", "Password@123");
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123");
  const coopCookie = await loginUser(server, "user2@example.com", "Password@123");
  const adminCookie = await loginUser(server, "admin@example.com", "Password@123");

  assert.ok(transporterCookie, "Transporter cookie must be obtained");
  assert.ok(inspectorCookie, "Inspector cookie must be obtained");
  assert.ok(coopCookie, "Coop cookie must be obtained");
  assert.ok(adminCookie, "Admin cookie must be obtained");

  // Setup test shipment in memory
  const testColdBox = "CB-PORTABLE-99";
  const testShipmentId = "shp-portable-99";
  inMemoryShipments.push({
    id: testShipmentId,
    code: testShipmentId,
    coldBoxId: testColdBox,
    containerId: testColdBox,
    organizationId: "org-trans",
    status: "IN_TRANSIT",
    currentTemperature: null,
    lastTemperatureAt: null,
    startedAt: "2026-10-17T00:00:00.000Z",
    createdAt: "2026-10-17T00:00:00.000Z",
  });

  await t.test("TC-S41-PORTABLE-01: Timestamp validation finite numbers, booleans, and invalid formats", async () => {
    // 1. Temperature: NaN
    const resNaN = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: "not-a-number", timestamp: new Date().toISOString() }
    );
    assert.equal(resNaN.status, 400);
    assert.equal(resNaN.body.error, "INVALID_TEMPERATURE");

    // 2. Temperature: Infinity
    const resInf = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: Infinity, timestamp: new Date().toISOString() }
    );
    assert.equal(resInf.status, 400);
    assert.equal(resInf.body.error, "INVALID_TEMPERATURE");

    // 3. Temperature: boolean true
    const resBoolTemp = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: true, timestamp: new Date().toISOString() }
    );
    assert.equal(resBoolTemp.status, 400);
    assert.equal(resBoolTemp.body.error, "INVALID_TEMPERATURE");

    // 4. Timestamp: boolean true
    const resBoolTs = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.5, timestamp: true }
    );
    assert.equal(resBoolTs.status, 400);
    assert.equal(resBoolTs.body.error, "INVALID_TIMESTAMP");

    // 5. Timestamp: invalid string
    const resBadTs = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.5, timestamp: "invalid-date-format" }
    );
    assert.equal(resBadTs.status, 400);
    assert.equal(resBadTs.body.error, "INVALID_TIMESTAMP");
  });

  await t.test("TC-S41-PORTABLE-02: Canonical cold-box resolution, whitespace trimming, and URL params", async () => {
    // 1. Whitespace trimming
    const resTrim = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: `  ${testColdBox}  `, temperature: 4.2, timestamp: "2026-10-17T12:00:00.000Z" }
    );
    assert.equal(resTrim.status, 200);
    assert.equal(resTrim.body.acknowledged, true);

    // 2. URL parameter: POST /api/cold-boxes/:code/temperatures
    const resUrlParam = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/cold-boxes/${testColdBox}/temperatures`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { temperature: 4.3, timestamp: "2026-10-17T12:05:00.000Z" }
    );
    assert.equal(resUrlParam.status, 200);
    assert.equal(resUrlParam.body.acknowledged, true);

    // 3. Resolving via shipmentId param: POST /api/shipments/:id/temperatures
    const resShipParam = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${testShipmentId}/temperatures`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { temperature: 4.4, timestamp: "2026-10-17T12:10:00.000Z" }
    );
    assert.equal(resShipParam.status, 200);
    assert.equal(resShipParam.body.acknowledged, true);

    // 4. Unknown cold box -> 404
    const resUnknown = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: "CB-NON-EXISTENT", temperature: 4.0, timestamp: "2026-10-17T12:00:00.000Z" }
    );
    assert.equal(resUnknown.status, 404);
    assert.equal(resUnknown.body.error, "NO_ACTIVE_SHIPMENT");
  });

  await t.test("TC-S41-PORTABLE-03: Session tenant enforcement, body spoof denial, and inspector write rejection", async () => {
    // 1. Cross-tenant rejection: coop (org-002) tries to record temperature on transporter shipment (org-trans)
    const resCross = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: coopCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.0, timestamp: "2026-10-17T12:20:00.000Z" }
    );
    assert.equal(resCross.status, 403);
    assert.equal(resCross.body.error, "FORBIDDEN_SHIPMENT_ACCESS");

    // 2. Body spoof attempt: passing organizationId in request body cannot bypass session
    const resSpoof = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: coopCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.0, timestamp: "2026-10-17T12:20:00.000Z", organizationId: "org-trans" }
    );
    assert.equal(resSpoof.status, 403);
    assert.equal(resSpoof.body.error, "FORBIDDEN_SHIPMENT_ACCESS");

    // 3. Inspector write rejection: inspector role has read-only access (403 HTTP + INSPECTOR_FORBIDDEN)
    const resInsp = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: inspectorCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.0, timestamp: "2026-10-17T12:20:00.000Z" }
    );
    assert.equal(resInsp.status, 403);
    assert.match(resInsp.body.message || resInsp.body.error, /Cán bộ kiểm tra|INSPECTOR_FORBIDDEN/);

    const directInsp = await recordShipmentTemperature({
      authContext: { userId: "usr-insp", isInspector: true, roleId: "inspector" },
      data: { coldBoxId: testColdBox, temperature: 4.0, timestamp: "2026-10-17T12:20:00.000Z" },
    });
    assert.equal(directInsp.status, 403);
    assert.equal(directInsp.error, "INSPECTOR_FORBIDDEN");

    // 4. Admin write allowed across tenants
    const resAdmin = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.5, timestamp: "2026-10-17T12:20:00.000Z" }
    );
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.body.acknowledged, true);
  });

  await t.test("TC-S41-PORTABLE-04: Active vs completed shipment rejection & historical retrieval", async () => {
    // Complete the shipment
    const ship = inMemoryShipments.find((s) => s.id === testShipmentId);
    ship.status = "COMPLETED";

    // Attempting to record temperature on completed shipment must return 400 SHIPMENT_ALREADY_ENDED
    const resEnded = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      { coldBoxId: testColdBox, temperature: 4.6, timestamp: "2026-10-17T12:30:00.000Z" }
    );
    assert.equal(resEnded.status, 400);
    assert.equal(resEnded.body.error, "SHIPMENT_ALREADY_ENDED");

    // Inspector CAN retrieve historical temperatures (GET 200)
    const resGetHist = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${testShipmentId}/temperatures`,
        method: "GET",
        headers: { Cookie: inspectorCookie },
      }
    );
    assert.equal(resGetHist.status, 200);
    assert.equal(resGetHist.body.success, true);
    assert.ok(Array.isArray(resGetHist.body.temperatures));
    assert.ok(resGetHist.body.count >= 1);
  });

  await t.test("TC-S41-PORTABLE-05: Cold box reuse delayed packet protection and storage boundary checks", async () => {
    // 1. Create and complete Shipment A with CB-REUSE-PORT
    await recordShipmentTemperature({
      authContext: { userId: "usr-trans", roleId: "transporter", organizationId: "org-trans" },
      data: { coldBoxId: "CB-REUSE-PORT", temperature: 5.0, timestamp: new Date(Date.now() - 10000).toISOString() },
    });
    // Complete any active shipment on CB-REUSE-PORT
    inMemoryShipments.push({
      id: "shp-reuse-a",
      coldBoxId: "CB-REUSE-PORT",
      status: "COMPLETED",
      organizationId: "org-trans",
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    });

    // 2. Start new Shipment B on CB-REUSE-PORT
    const nowB = Date.now();
    const shipB = {
      id: "shp-reuse-b",
      coldBoxId: "CB-REUSE-PORT",
      status: "IN_TRANSIT",
      organizationId: "org-trans",
      startedAt: new Date(nowB).toISOString(),
      createdAt: new Date(nowB).toISOString(),
      currentTemperature: null,
      lastTemperatureAt: null,
    };
    inMemoryShipments.unshift(shipB);

    // 3. Delayed packet from A (10 minutes before B started)
    const delayedFromA = await recordShipmentTemperature({
      authContext: { userId: "usr-trans", roleId: "transporter", organizationId: "org-trans" },
      data: {
        coldBoxId: "CB-REUSE-PORT",
        temperature: 9.9,
        timestamp: new Date(nowB - 600000).toISOString(),
      },
    });
    assert.equal(delayedFromA.status, 200);
    assert.equal(delayedFromA.acknowledged, true);
    assert.equal(delayedFromA.ignored, true);
    assert.equal(shipB.currentTemperature, null);

    // 4. Numeric overflow prevention: 1000.0 returns 400
    const resOverflow = await recordShipmentTemperature({
      authContext: { userId: "usr-trans", roleId: "transporter", organizationId: "org-trans" },
      data: {
        coldBoxId: "CB-REUSE-PORT",
        temperature: 1000.0,
        timestamp: new Date(nowB + 1000).toISOString(),
      },
    });
    assert.equal(resOverflow.status, 400);
    assert.equal(resOverflow.error, "INVALID_TEMPERATURE");

    // 5. Accelerated fixture timestamps: valid future timestamps are accepted (no arbitrary 24h skew blocking S42)
    const resAccelerated = await recordShipmentTemperature({
      authContext: { userId: "usr-trans", roleId: "transporter", organizationId: "org-trans" },
      data: {
        coldBoxId: "CB-REUSE-PORT",
        temperature: 4.0,
        timestamp: new Date(Date.now() + 86400000 * 2).toISOString(),
      },
    });
    assert.equal(resAccelerated.status, 200);
    assert.equal(resAccelerated.acknowledged, true);

    // 6. Strict calendar date and format rejection: ambiguous strings, invalid calendar dates (Feb 31, Month 13)
    const invalidDates = [
      "1",
      "invalid-date",
      "2026-02-31T12:00:00.000Z",
      "2026-13-01T12:00:00.000Z",
      "2026-04-31T12:00:00.000Z",
      "2026-10-17T25:00:00.000Z",
      "2026-10-17T12:60:00.000Z",
    ];
    for (const badDate of invalidDates) {
      const resBad = await recordShipmentTemperature({
        authContext: { userId: "usr-trans", roleId: "transporter", organizationId: "org-trans" },
        data: {
          coldBoxId: "CB-REUSE-PORT",
          temperature: 4.0,
          timestamp: badDate,
        },
      });
      assert.equal(resBad.status, 400, `Expected 400 for bad timestamp '${badDate}'`);
      assert.equal(resBad.error, "INVALID_TIMESTAMP");
    }
  });
});

