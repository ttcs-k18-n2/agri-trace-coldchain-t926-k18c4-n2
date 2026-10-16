const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app, users, seedDemoUser } = require("../src/server");
const { scopedQuery, scopedQueryById } = require("../src/query");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}: ${res.body.message}`);
  return agent;
}

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("Permission Matrix: Admin has global read access via scopedQuery and scopedQueryById", async () => {
  // 1. scopedQuery for Admin does not append WHERE organization_id = $1
  const adminContext = { roleId: "admin", organizationId: "org-system", isAdmin: true };
  const queryAll = await scopedQuery(null, adminContext, "lots");
  assert.equal(queryAll.sql, "SELECT * FROM lots");
  assert.deepEqual(queryAll.params, []);

  // 2. scopedQueryById for Admin does not append AND organization_id = $2
  const queryById = await scopedQueryById(null, adminContext, "lots", "LOT-001");
  assert.equal(queryById.sql, "SELECT * FROM lots WHERE id = $1");
  assert.deepEqual(queryById.params, ["LOT-001"]);

  // 3. Admin HTTP client can read Org-1 lot and Org-2 lot without 403
  const adminAgent = await loginAs("admin@example.com");
  const readOrg1 = await adminAgent.get("/api/lots/LOT-001");
  assert.equal(readOrg1.status, 200);
  assert.equal(readOrg1.body.lot.id, "LOT-001");

  const readOrg2 = await adminAgent.get("/api/lots/LOT-101");
  assert.equal(readOrg2.status, 200);
  assert.equal(readOrg2.body.lot.id, "LOT-101");
});

test("Permission Matrix: Org Admin has write access within own org, denied cross-tenant and product create", async () => {
  const orgAdminAgent = await loginAs("orgadmin@example.com");

  // Can create farm in own org (org-001)
  const farmRes = await orgAdminAgent.post("/api/farms").send({
    name: "Thửa Đất Org Admin 1",
    area: 5.5,
  });
  assert.equal(farmRes.status, 201);
  assert.equal(farmRes.body.farm.organizationId, "org-001");

  // Can register harvest in own org
  const harvestRes = await orgAdminAgent.post("/api/lots").send({
    farmId: "FARM-001",
    productId: "PROD-TOMATO",
    quantity: 150,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(harvestRes.status, 201);
  assert.equal(harvestRes.body.lot.organizationId, "org-001");

  // Cannot create harvest on another org's farm (FARM-101 belongs to org-002)
  const crossHarvest = await orgAdminAgent.post("/api/lots").send({
    farmId: "FARM-101",
    productId: "PROD-TOMATO",
    quantity: 50,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(crossHarvest.status, 403);
  assert.match(crossHarvest.body.message, /tổ chức khác/i);

  // Cannot read cross-tenant lot by ID
  const crossLot = await orgAdminAgent.get("/api/lots/LOT-101");
  assert.equal(crossLot.status, 403);
  assert.match(crossLot.body.message, /tổ chức khác/i);

  // Cannot create global product catalog (Admin only)
  const prodRes = await orgAdminAgent.post("/api/products").send({
    name: "Sản phẩm OrgAdmin",
    unit: "kg",
  });
  assert.equal(prodRes.status, 403);
  assert.match(prodRes.body.message, /không có quyền/i);
});

test("Permission Matrix: Producer can manage farm & harvest for own org, denied cross-tenant and products", async () => {
  const producerAgent = await loginAs("user@example.com");

  // Can create farm for own org
  const farmRes = await producerAgent.post("/api/farms").send({
    name: "Vườn Bưởi Producer",
    area: 2.5,
  });
  assert.equal(farmRes.status, 201);

  // Can create harvest for own org
  const harvestRes = await producerAgent.post("/api/lots").send({
    farmId: "FARM-001",
    productId: "PROD-TOMATO",
    quantity: 80,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(harvestRes.status, 201);

  // Denied creating product catalog
  const prodRes = await producerAgent.post("/api/products").send({
    name: "Sản phẩm Producer",
    unit: "kg",
  });
  assert.equal(prodRes.status, 403);

  // Denied harvest on foreign farm
  const crossHarvest = await producerAgent.post("/api/lots").send({
    farmId: "FARM-101",
    productId: "PROD-TOMATO",
    quantity: 20,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(crossHarvest.status, 403);
});

test("Permission Matrix: Cooperative can manage harvest in own org, denied product create", async () => {
  const coopAgent = await loginAs("user2@example.com"); // org-002, cooperative

  // Can create harvest in own org (FARM-101)
  const harvestRes = await coopAgent.post("/api/lots").send({
    farmId: "FARM-101",
    productId: "PROD-TOMATO",
    quantity: 300,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(harvestRes.status, 201);
  assert.equal(harvestRes.body.lot.organizationId, "org-002");

  // Denied product catalog creation
  const prodRes = await coopAgent.post("/api/products").send({
    name: "Sản phẩm HTX",
    unit: "kg",
  });
  assert.equal(prodRes.status, 403);
});

test("Permission Matrix: Transporter and Distributor are FORBIDDEN from creating harvest via both POST /api/lots and legacy POST /api/organization/lots", async () => {
  const transporterAgent = await loginAs("transporter@example.com");
  const distributorAgent = await loginAs("distributor@example.com");

  for (const agent of [transporterAgent, distributorAgent]) {
    // 1. Direct harvest endpoint
    const postLots = await agent.post("/api/lots").send({
      farmId: "FARM-001",
      productId: "PROD-001",
      quantity: 50,
      harvestedAt: new Date().toISOString().slice(0, 10),
    });
    assert.equal(postLots.status, 403, "Transporter/Distributor must not create lots via /api/lots");

    // 2. Legacy lot creation endpoint
    const postOrgLots = await agent.post("/api/organization/lots").send({
      name: "Lô hàng trái phép",
    });
    assert.equal(postOrgLots.status, 403, "Transporter/Distributor must not bypass via legacy /api/organization/lots");
  }
});

test("Permission Matrix: Inspector can read across all orgs (200), but write operations are strictly 403", async () => {
  const inspectorAgent = await loginAs("inspector@example.com");

  // Read Org 1 lot -> 200
  const readOrg1 = await inspectorAgent.get("/api/lots/LOT-001");
  assert.equal(readOrg1.status, 200);

  // Read Org 2 lot -> 200
  const readOrg2 = await inspectorAgent.get("/api/lots/LOT-101");
  assert.equal(readOrg2.status, 200);

  // Write lot -> 403
  const writeLot = await inspectorAgent.post("/api/lots").send({
    farmId: "FARM-001",
    productId: "PROD-001",
    quantity: 10,
    harvestedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(writeLot.status, 403);

  // Write legacy lot -> 403
  const writeLegacyLot = await inspectorAgent.post("/api/organization/lots").send({
    name: "Lô của Inspector",
  });
  assert.equal(writeLegacyLot.status, 403);

  // Write farm -> 403
  const writeFarm = await inspectorAgent.post("/api/farms").send({
    name: "Thửa đất của Inspector",
    area: 1.0,
  });
  assert.equal(writeFarm.status, 403);

  // Write product -> 403
  const writeProd = await inspectorAgent.post("/api/products").send({
    name: "Sản phẩm Inspector",
    unit: "kg",
  });
  assert.equal(writeProd.status, 403);
});

test("Permission Matrix: Cross-tenant access is denied 403 with security audit", async () => {
  const agent1 = await loginAs("user@example.com"); // org-001
  const res = await agent1.get("/api/lots/LOT-101"); // belongs to org-002
  assert.equal(res.status, 403);
  assert.match(res.body.message, /tổ chức khác/i);
});

test("Permission Matrix: Unmapped / undeclared routes return 403 Default Deny", async () => {
  const agent = await loginAs("user@example.com");
  const res = await agent.get("/api/unmapped-protected");
  assert.equal(res.status, 403);
  assert.match(res.body.message, /chưa khai báo quyền/i);
});
