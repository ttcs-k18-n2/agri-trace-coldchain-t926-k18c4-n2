const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app, users, seedDemoUser } = require("../src/server");
const { scopedQuery } = require("../src/query");

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("T-12: scopedQuery throws error when called without organization context on tenant table", async () => {
  await assert.rejects(
    async () => {
      await scopedQuery(null, null, "lots");
    },
    (err) => {
      assert.match(err.message, /thiếu ngữ cảnh tổ chức/i);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await scopedQuery(null, { organizationId: null, roleId: "producer" }, "lots");
    },
    (err) => {
      assert.match(err.message, /thiếu ngữ cảnh tổ chức/i);
      return true;
    }
  );
});

test("T-12: scopedQuery allows shared tables (roles, products) without organization context", async () => {
  const rolesQuery = await scopedQuery(null, null, "roles");
  assert.ok(rolesQuery.sql.includes("roles"));

  const productsQuery = await scopedQuery(null, null, "products");
  assert.ok(productsQuery.sql.includes("products"));
});

test("T-11: Default deny returns 403 on unmapped / undeclared routes", async () => {
  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  const res = await agent.get("/api/unmapped-protected");
  assert.equal(res.status, 403);
  assert.match(res.body.message, /chưa khai báo quyền/i);
});

test("T-13: Tenant 1 (org-001) reads own lot returns 200, reads Org 2 lot returns 403", async () => {
  const agent1 = request.agent(app);
  await agent1
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  // Read own lot (LOT-001) -> 200 OK
  const ownRes = await agent1.get("/api/organization/lots/LOT-001");
  assert.equal(ownRes.status, 200);
  assert.equal(ownRes.body.lot.id, "LOT-001");

  // Read cross-tenant lot (LOT-101 of org-002) -> 403 Forbidden
  const crossRes = await agent1.get("/api/organization/lots/LOT-101");
  assert.equal(crossRes.status, 403);
  assert.match(crossRes.body.message, /tổ chức khác/i);
});

test("T-13: Tenant 2 (org-002) reads own lot returns 200, reads Org 1 lot returns 403", async () => {
  const agent2 = request.agent(app);
  await agent2
    .post("/api/login")
    .send({ email: "user2@example.com", password: "Password@123" });

  // Read own lot (LOT-101) -> 200 OK
  const ownRes = await agent2.get("/api/organization/lots/LOT-101");
  assert.equal(ownRes.status, 200);
  assert.equal(ownRes.body.lot.id, "LOT-101");

  // Read cross-tenant lot (LOT-001 of org-001) -> 403 Forbidden
  const crossRes = await agent2.get("/api/organization/lots/LOT-001");
  assert.equal(crossRes.status, 403);
  assert.match(crossRes.body.message, /tổ chức khác/i);
});

test("T-13: Inspector reads lots across all organizations (200), but write operations are forbidden (403)", async () => {
  const inspectorAgent = request.agent(app);
  await inspectorAgent
    .post("/api/login")
    .send({ email: "inspector@example.com", password: "Password@123" });

  // Inspector can read Org 1 lot -> 200
  const readOrg1 = await inspectorAgent.get("/api/organization/lots/LOT-001");
  assert.equal(readOrg1.status, 200);

  // Inspector can read Org 2 lot -> 200
  const readOrg2 = await inspectorAgent.get("/api/organization/lots/LOT-101");
  assert.equal(readOrg2.status, 200);

  // Inspector CANNOT write -> 403 Forbidden
  const writeRes = await inspectorAgent
    .post("/api/organization/lots")
    .send({ name: "Lô của Inspector" });

  assert.equal(writeRes.status, 403);
  assert.match(writeRes.body.message, /chỉ có quyền đọc/i);
});
