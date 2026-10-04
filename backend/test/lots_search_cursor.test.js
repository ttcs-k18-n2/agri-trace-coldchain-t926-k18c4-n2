const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const request = require("supertest");
const { Pool } = require("pg");
const { app, users, seedDemoUser, inMemoryLots } = require("../src/server");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("S-14 / T-33: Tenant isolation - Organization lots are strictly scoped to user tenant", async () => {
  // Setup 2 lots in memory for different orgs
  inMemoryLots.length = 0;
  inMemoryLots.push(
    {
      id: "LOT-ORG1-01",
      name: "Org 1 Lot",
      organizationId: "org-001",
      productId: "PROD-TEA",
      farmId: "FARM-001",
      harvestedAt: "2026-10-04",
      createdAt: "2026-10-04T08:00:00.000Z",
    },
    {
      id: "LOT-ORG2-01",
      name: "Org 2 Lot",
      organizationId: "org-002",
      productId: "PROD-TEA",
      farmId: "FARM-101",
      harvestedAt: "2026-10-04",
      createdAt: "2026-10-04T08:00:00.000Z",
    }
  );

  const org1Agent = await loginAs("user@example.com"); // org-001
  const res1 = await org1Agent.get("/api/organization/lots");
  assert.equal(res1.status, 200);
  assert.ok(res1.body.lots.every((l) => l.organizationId === "org-001"));
  assert.ok(res1.body.lots.some((l) => l.id === "LOT-ORG1-01"));
  assert.ok(!res1.body.lots.some((l) => l.id === "LOT-ORG2-01"));

  const org2Agent = await loginAs("user2@example.com"); // org-002
  const res2 = await org2Agent.get("/api/organization/lots");
  assert.equal(res2.status, 200);
  assert.ok(res2.body.lots.every((l) => l.organizationId === "org-002"));
  assert.ok(res2.body.lots.some((l) => l.id === "LOT-ORG2-01"));
  assert.ok(!res2.body.lots.some((l) => l.id === "LOT-ORG1-01"));
});

test("S-14 / T-33: Case-insensitive search on lot ID", async () => {
  inMemoryLots.length = 0;
  inMemoryLots.push(
    {
      id: "LOT-X82KP92A",
      name: "Chè Oolong",
      organizationId: "org-001",
      productId: "PROD-TEA",
      farmId: "FARM-001",
      harvestedAt: "2026-10-04",
    },
    {
      id: "LOT-ABC12345",
      name: "Cà chua",
      organizationId: "org-001",
      productId: "PROD-TOMATO",
      farmId: "FARM-001",
      harvestedAt: "2026-10-03",
    }
  );

  const agent = await loginAs("user@example.com");

  // Search with lowercase partial code "82kp"
  const searchLower = await agent.get("/api/organization/lots?search=82kp");
  assert.equal(searchLower.status, 200);
  assert.equal(searchLower.body.lots.length, 1);
  assert.equal(searchLower.body.lots[0].id, "LOT-X82KP92A");

  // Search with uppercase "ABC"
  const searchUpper = await agent.get("/api/organization/lots?search=ABC");
  assert.equal(searchUpper.status, 200);
  assert.equal(searchUpper.body.lots.length, 1);
  assert.equal(searchUpper.body.lots[0].id, "LOT-ABC12345");
});

test("S-14 / T-33: Product filter isolates target product", async () => {
  inMemoryLots.length = 0;
  inMemoryLots.push(
    {
      id: "LOT-P1",
      name: "Lô 1",
      organizationId: "org-001",
      productId: "PROD-TEA",
      farmId: "FARM-001",
      harvestedAt: "2026-10-04",
    },
    {
      id: "LOT-P2",
      name: "Lô 2",
      organizationId: "org-001",
      productId: "PROD-MELON",
      farmId: "FARM-001",
      harvestedAt: "2026-10-04",
    }
  );

  const agent = await loginAs("user@example.com");

  const filterTea = await agent.get("/api/organization/lots?productId=PROD-TEA");
  assert.equal(filterTea.status, 200);
  assert.equal(filterTea.body.lots.length, 1);
  assert.equal(filterTea.body.lots[0].productId, "PROD-TEA");

  const filterMelon = await agent.get("/api/organization/lots?productId=PROD-MELON");
  assert.equal(filterMelon.status, 200);
  assert.equal(filterMelon.body.lots.length, 1);
  assert.equal(filterMelon.body.lots[0].productId, "PROD-MELON");
});

test("S-14 / T-33: Cursor-based pagination without skipping or duplicating records", async () => {
  // Generate 35 lots with distinct dates and IDs
  inMemoryLots.length = 0;
  const baseEpoch = 1727740800000; // 2026-10-01
  for (let i = 1; i <= 35; i++) {
    const d = new Date(baseEpoch + i * 86400000);
    inMemoryLots.push({
      id: `LOT-PAG-${String(i).padStart(3, "0")}`,
      name: `Lot #${i}`,
      organizationId: "org-001",
      productId: "PROD-TEA",
      farmId: "FARM-001",
      harvestedAt: d.toISOString().slice(0, 10),
      createdAt: d.toISOString(),
    });
  }

  const agent = await loginAs("user@example.com");

  // Page 1: limit=20
  const page1 = await agent.get("/api/organization/lots?limit=20");
  assert.equal(page1.status, 200);
  assert.equal(page1.body.lots.length, 20);
  assert.equal(page1.body.hasMore, true);
  assert.ok(page1.body.nextCursor, "nextCursor must be returned when hasMore is true");

  // Verify newest first
  assert.equal(page1.body.lots[0].id, "LOT-PAG-035");

  // Page 2: with cursor
  const page2 = await agent.get(`/api/organization/lots?limit=20&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
  assert.equal(page2.status, 200);
  assert.equal(page2.body.lots.length, 15);
  assert.equal(page2.body.hasMore, false);
  assert.equal(page2.body.nextCursor, null);

  // Check no duplicates between Page 1 and Page 2
  const ids1 = new Set(page1.body.lots.map((l) => l.id));
  const ids2 = new Set(page2.body.lots.map((l) => l.id));

  for (const id of ids2) {
    assert.ok(!ids1.has(id), `Duplicate ID found across pages: ${id}`);
  }

  // Combined count should equal 35
  assert.equal(ids1.size + ids2.size, 35);
});

test("S-14 / T-33 Benchmark: 5,000 lots query executes in < 300 ms", async () => {
  // Populate 5,000 lots
  inMemoryLots.length = 0;
  const baseTime = 1700000000000;
  for (let i = 1; i <= 5000; i++) {
    const time = new Date(baseTime + i * 60000);
    inMemoryLots.push({
      id: `LOT-${i.toString(36).toUpperCase().padStart(8, "0")}`,
      name: `Benchmark Lot ${i}`,
      organizationId: i % 2 === 0 ? "org-001" : "org-002",
      productId: i % 3 === 0 ? "PROD-TEA" : "PROD-TOMATO",
      farmId: "FARM-001",
      harvestedAt: time.toISOString().slice(0, 10),
      createdAt: time.toISOString(),
    });
  }

  const agent = await loginAs("user@example.com");

  const start = performance.now();
  const res = await agent.get("/api/organization/lots?search=ABC&productId=PROD-TEA&limit=20");
  const elapsed = performance.now() - start;

  assert.equal(res.status, 200);
  assert.ok(
    elapsed < 300,
    `Query against 5,000 lots took ${elapsed.toFixed(2)}ms (must be < 300ms)`
  );
});

test("S-14 / T-33 Live PostgreSQL: Cursor pagination and indices test", async (t) => {
  const MIGRATION_DB_URL =
    process.env.MIGRATION_DATABASE_URL || "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";

  let migrationDb;
  try {
    migrationDb = new Pool({ connectionString: MIGRATION_DB_URL, connectionTimeoutMillis: 3000 });
    await migrationDb.query("SELECT 1;");
  } catch (err) {
    t.skip(`PostgreSQL not reachable (${err.message}), skipping live SQL query test`);
    return;
  }

  t.after(async () => {
    try {
      await migrationDb.end();
    } catch {
      // cleanup
    }
  });

  // Verify indices exist in PostgreSQL catalog
  const indexCheck = await migrationDb.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'lots' AND indexname IN (
      'idx_lots_org_harvest_created_id',
      'idx_lots_org_product_harvest'
    );
  `);

  assert.equal(
    indexCheck.rows.length,
    2,
    "Both idx_lots_org_harvest_created_id and idx_lots_org_product_harvest must exist in PostgreSQL"
  );

  // S-14 / T-33 Benchmark on real PostgreSQL: 5,000 lots query < 300ms
  const testOrgId = `perf-pg-${Date.now()}`;
  const testProductId = "PROD-TEA";

  await migrationDb.query(`
    INSERT INTO organizations (id, name, type) VALUES ($1, 'Perf Org', 'producer') ON CONFLICT (id) DO NOTHING;
  `, [testOrgId]);

  await migrationDb.query(`
    INSERT INTO lots (id, name, status, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at, created_at)
    SELECT
      'LOT-PERF-' || lpad(i::text, 5, '0'),
      'Lô kiểm thử ' || i,
      'Đã thu hoạch',
      $1,
      'FARM-001',
      $2,
      100 + (i % 50),
      100 + (i % 50),
      (CURRENT_DATE - (i || ' days')::interval)::date,
      (NOW() - (i || ' minutes')::interval)
    FROM generate_series(1, 5000) AS s(i);
  `, [testOrgId, testProductId]);

  try {
    const start = performance.now();
    const queryResult = await migrationDb.query(`
      SELECT id, name, status, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at, created_at
      FROM lots
      WHERE organization_id = $1
        AND id ILIKE $2
        AND product_id = $3
      ORDER BY harvested_at DESC, created_at DESC, id DESC
      LIMIT 21;
    `, [testOrgId, "%PERF%", testProductId]);
    const elapsed = performance.now() - start;

    assert.equal(queryResult.rows.length, 21, "Should retrieve 21 rows for cursor calculation");
    assert.ok(
      elapsed < 300,
      `PostgreSQL query on 5,000 indexed lots took ${elapsed.toFixed(2)}ms (must be < 300ms)`
    );
  } finally {
    try {
      await migrationDb.query("DELETE FROM lots WHERE id LIKE 'LOT-PERF-%'");
      await migrationDb.query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
    } catch {
      // cleanup best effort
    }
  }
});

test("S-14 / T-34 Frontend Route: /lot-detail requires auth and returns 200 for authenticated session", async () => {
  const unauthRes = await request(app).get("/lot-detail");
  assert.equal(unauthRes.status, 302, "Unauthenticated access should redirect to /login");

  const agent = await loginAs("user@example.com");
  const authRes = await agent.get("/lot-detail?id=LOT-001");
  assert.equal(authRes.status, 200, "Authenticated user should receive lot-detail.html");
  assert.match(authRes.text, /Chi tiết lô thu hoạch/);
});
