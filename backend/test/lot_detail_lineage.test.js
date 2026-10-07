const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchEvents,
  inMemoryProducts,
  inMemoryFarms,
  setDatabasePool,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Lot Detail Direct Lineage & Multi-tenant S-23 Access Control (GET /api/lots/:id)", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  users.set("producer@org1.vn", {
    id: "usr-prod-org1",
    email: "producer@org1.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "producer",
  });

  users.set("coop@org2.vn", {
    id: "usr-coop-org2",
    email: "coop@org2.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-002",
    roleId: "cooperative",
  });

  users.set("dist@org3.vn", {
    id: "usr-dist-org3",
    email: "dist@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-003",
    roleId: "distributor",
  });

  users.set("inspector@gov.vn", {
    id: "usr-inspector-gov",
    email: "inspector@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  const testLotIds = [
    "LOT-TEST-ROOT",
    "LOT-TEST-CHILD-1",
    "LOT-TEST-CHILD-2",
    "LOT-TEST-GRANDCHILD",
    "LOT-TEST-UNRELATED",
  ];

  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (testLotIds.includes(inMemoryLots[i].id)) inMemoryLots.splice(i, 1);
  }

  // Setup test hierarchy:
  // Root Lot (Org 1, Tomato) -> Child Lot 1 (Org 2, Processed Tomato), Child Lot 2 (Org 2, Export Tomato)
  // Child Lot 1 -> Grandchild Lot (Org 3, Packaged Retail)
  // Unrelated Lot (Org 1, Tea)
  inMemoryLots.push(
    {
      id: "LOT-TEST-ROOT",
      name: "Lô Cà chua gốc F0",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      farmId: "FARM-002",
      productId: "PROD-TOMATO",
      initialQuantity: 1000,
      remainingQuantity: 200,
      harvestedAt: "2026-10-01",
      parentLotId: null,
      createdAt: "2026-10-01T08:00:00.000Z",
    },
    {
      id: "LOT-TEST-CHILD-1",
      name: "Lô Cà chua sơ chế loại 1",
      status: "Đang chế biến",
      organizationId: "org-002",
      farmId: "FARM-002",
      productId: "PROD-TOMATO",
      initialQuantity: 500,
      remainingQuantity: 100,
      harvestedAt: "2026-10-02",
      parentLotId: "LOT-TEST-ROOT",
      createdAt: "2026-10-02T09:00:00.000Z",
    },
    {
      id: "LOT-TEST-CHILD-2",
      name: "Lô Cà chua xuất khẩu loại 2",
      status: "Đã nhập kho",
      organizationId: "org-002",
      farmId: "FARM-002",
      productId: "PROD-TOMATO",
      initialQuantity: 300,
      remainingQuantity: 300,
      harvestedAt: "2026-10-02",
      parentLotId: "LOT-TEST-ROOT",
      createdAt: "2026-10-02T10:00:00.000Z",
    },
    {
      id: "LOT-TEST-GRANDCHILD",
      name: "Lô Cà chua đóng gói phân phối",
      status: "Đang vận chuyển",
      organizationId: "org-003",
      farmId: null,
      productId: "PROD-TOMATO",
      initialQuantity: 400,
      remainingQuantity: 400,
      harvestedAt: "2026-10-03",
      parentLotId: "LOT-TEST-CHILD-1",
      createdAt: "2026-10-03T11:00:00.000Z",
    },
    {
      id: "LOT-TEST-UNRELATED",
      name: "Lô Chè Thái Nguyên riêng lẻ",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      farmId: "FARM-001",
      productId: "PROD-TEA",
      initialQuantity: 150,
      remainingQuantity: 150,
      harvestedAt: "2026-10-01",
      parentLotId: null,
      createdAt: "2026-10-01T07:00:00.000Z",
    }
  );

  const org1Agent = await loginAs("producer@org1.vn");
  const org2Agent = await loginAs("coop@org2.vn");
  const org3Agent = await loginAs("dist@org3.vn");
  const inspectorAgent = await loginAs("inspector@gov.vn");

  await t.test("1. GET /api/lots/:id returns full specifications and parentLot: null for root lot", async () => {
    const res = await org1Agent.get("/api/lots/LOT-TEST-ROOT");
    assert.equal(res.status, 200);
    assert.ok(res.body.lot);

    const lot = res.body.lot;
    assert.equal(lot.id, "LOT-TEST-ROOT");
    assert.equal(lot.productName, "Cà chua");
    assert.equal(lot.productUnit, "kg");
    assert.equal(lot.farmName, "Thửa cà chua Hùng Sơn 02");
    assert.equal(lot.initialQuantity, 1000);
    assert.equal(lot.remainingQuantity, 200);
    assert.equal(lot.status, "Đã thu hoạch");
    assert.equal(lot.parentLotId, null);
    assert.equal(lot.parentLot, null);

    // Child lots direct relationship
    assert.ok(Array.isArray(lot.childLots));
    assert.equal(lot.childLots.length, 2);
    const childIds = lot.childLots.map((c) => c.id);
    assert.ok(childIds.includes("LOT-TEST-CHILD-1"));
    assert.ok(childIds.includes("LOT-TEST-CHILD-2"));
  });

  await t.test("2. GET /api/lots/:id returns direct parent lot information and direct child lots for child lot", async () => {
    const res = await org2Agent.get("/api/lots/LOT-TEST-CHILD-1");
    assert.equal(res.status, 200);

    const lot = res.body.lot;
    assert.equal(lot.id, "LOT-TEST-CHILD-1");
    assert.equal(lot.parentLotId, "LOT-TEST-ROOT");
    assert.ok(lot.parentLot);
    assert.equal(lot.parentLot.id, "LOT-TEST-ROOT");
    assert.equal(lot.parentLot.name, "Lô Cà chua gốc F0");
    assert.equal(lot.parentLot.productName, "Cà chua");
    assert.equal(lot.parentLot.status, "Đã thu hoạch");

    // Direct child of child-1 is grandchild
    assert.ok(Array.isArray(lot.childLots));
    assert.equal(lot.childLots.length, 1);
    assert.equal(lot.childLots[0].id, "LOT-TEST-GRANDCHILD");
    assert.equal(lot.childLots[0].initialQuantity, 400);
  });

  await t.test("3. S-23 Access Control: Unrelated tenant gets 403 Forbidden", async () => {
    // Org 3 (Distributor) holds Grandchild, which derives from Child-1 and Root.
    // However, LOT-TEST-UNRELATED belongs to Org 1 and is completely unrelated.
    const forbiddenRes = await org3Agent.get("/api/lots/LOT-TEST-UNRELATED");
    assert.equal(forbiddenRes.status, 403);
    assert.match(forbiddenRes.body.message, /bị từ chối/i);
  });

  await t.test("4. S-23 Ancestor Access: Downstream tenant (Org 3) can view ancestor lot (Root) with lineage", async () => {
    const res = await org3Agent.get("/api/lots/LOT-TEST-ROOT");
    assert.equal(res.status, 200);
    assert.equal(res.body.lot.id, "LOT-TEST-ROOT");
  });

  await t.test("5. Inspector has global access to all lots and lineage without cross-tenant restriction", async () => {
    const rootRes = await inspectorAgent.get("/api/lots/LOT-TEST-ROOT");
    assert.equal(rootRes.status, 200);
    assert.equal(rootRes.body.lot.childLots.length, 2);

    const unrelatedRes = await inspectorAgent.get("/api/lots/LOT-TEST-UNRELATED");
    assert.equal(unrelatedRes.status, 200);
    assert.equal(unrelatedRes.body.lot.id, "LOT-TEST-UNRELATED");
  });

  await t.test("6. T-58 / S-25: GET /api/lots/:id performs <= 3 SQL queries against database", async () => {
    let queryCount = 0;
    const executedQueries = [];

    // Mock PostgreSQL pool to intercept and count SQL queries
    const mockPool = {
      query: async (sql, params) => {
        queryCount++;
        executedQueries.push(sql.trim().replace(/\s+/g, " "));

        // evaluateLotAccess: fetchAllLotsRaw
        if (sql.includes("SELECT * FROM lots")) {
          return {
            rows: [
              {
                id: "LOT-SQL-TEST-01",
                name: "Lô Cà chua Bi Đà Lạt",
                status: "Đã thu hoạch",
                organization_id: "org-001",
                farm_id: "FARM-001",
                product_id: "PROD-TOMATO",
                initial_quantity: "500",
                remaining_quantity: "500",
                harvested_at: "2026-10-05T08:00:00.000Z",
                created_at: "2026-10-05T08:00:00.000Z",
                parent_lot_id: null,
              },
            ],
          };
        }

        // Query 1: Lot header + parent join
        if (sql.includes("FROM lots l")) {
          return {
            rows: [
              {
                id: "LOT-SQL-TEST-01",
                name: "Lô Cà chua Bi Đà Lạt",
                status: "Đã thu hoạch",
                organization_id: "org-001",
                farm_id: "FARM-001",
                product_id: "PROD-TOMATO",
                initial_quantity: "500",
                remaining_quantity: "500",
                harvested_at: "2026-10-05T08:00:00.000Z",
                created_at: "2026-10-05T08:00:00.000Z",
                parent_lot_id: null,
                farm_name: "Nông trại Rau sạch Đà Lạt",
                product_name: "Cà chua Bi",
                product_unit: "kg",
                organization_name: "Nông trại Xanh (Org 1)",
                parent_id: null,
                parent_name: null,
                parent_status: null,
                parent_product_id: null,
                parent_organization_id: null,
                parent_initial_quantity: null,
                parent_remaining_quantity: null,
                parent_product_name: null,
                parent_product_unit: null,
                parent_organization_name: null,
              },
            ],
          };
        }

        // Query 2: Child lots
        if (sql.includes("WHERE c.parent_lot_id = $1") || sql.includes("FROM lots c")) {
          return {
            rows: [],
          };
        }

        // Any other DB lookup (e.g., organizations or batches)
        return { rows: [] };
      },
    };

    const org1Agent = await loginAs("producer@org1.vn");

    try {
      setDatabasePool(mockPool);
      queryCount = 0;
      executedQueries.length = 0;

      const res = await org1Agent.get("/api/lots/LOT-SQL-TEST-01");

      assert.equal(res.status, 200);
      assert.ok(res.body.lot);
      assert.equal(res.body.lot.id, "LOT-SQL-TEST-01");
      assert.equal(res.body.lot.name, "Lô Cà chua Bi Đà Lạt");

      // T-58 requirement: optimize route to <= 3 SQL queries
      assert.ok(
        queryCount <= 3,
        `Expected <= 3 SQL queries for lot detail, but executed ${queryCount} queries:\n` +
          executedQueries.map((q, idx) => `  ${idx + 1}: ${q}`).join("\n")
      );
    } finally {
      setDatabasePool(null);
    }
  });
});

