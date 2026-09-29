const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app, users, seedDemoUser } = require("../src/server");

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("T-14 & T-15: GET /api/farms returns only current organization farms", async () => {
  const agent1 = request.agent(app);
  await agent1
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  const res1 = await agent1.get("/api/farms");
  assert.equal(res1.status, 200);
  assert.ok(res1.body.farms.length > 0);
  for (const farm of res1.body.farms) {
    assert.equal(farm.organizationId, "org-001");
  }

  const agent2 = request.agent(app);
  await agent2
    .post("/api/login")
    .send({ email: "user2@example.com", password: "Password@123" });

  const res2 = await agent2.get("/api/farms");
  assert.equal(res2.status, 200);
  for (const farm of res2.body.farms) {
    assert.equal(farm.organizationId, "org-002");
  }
});

test("T-14 & T-15: POST /api/farms rejects area <= 0 and empty name with field-level errors", async () => {
  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  // Area = 0 rejected
  const zeroAreaRes = await agent
    .post("/api/farms")
    .send({ name: "Thửa thử nghiệm", area: 0 });
  assert.equal(zeroAreaRes.status, 400);
  assert.ok(zeroAreaRes.body.errors.area);

  // Negative area rejected
  const negAreaRes = await agent
    .post("/api/farms")
    .send({ name: "Thửa thử nghiệm", area: -1.5 });
  assert.equal(negAreaRes.status, 400);
  assert.ok(negAreaRes.body.errors.area);

  // Empty name rejected
  const emptyNameRes = await agent
    .post("/api/farms")
    .send({ name: "   ", area: 2.0 });
  assert.equal(emptyNameRes.status, 400);
  assert.ok(emptyNameRes.body.errors.name);
});

test("T-15: POST /api/farms creates farm with valid data and attaches to current org", async () => {
  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  const createRes = await agent
    .post("/api/farms")
    .send({ name: "Thửa cam sành mới", area: 1.85, coordinates: "21.60, 105.70" });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.farm.name, "Thửa cam sành mới");
  assert.equal(createRes.body.farm.area, 1.85);
  assert.equal(createRes.body.farm.organizationId, "org-001");
});

test("T-15: PUT /api/farms/:id updates farm; cross-tenant update is forbidden (403)", async () => {
  const agent1 = request.agent(app);
  await agent1
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  // Update own farm (FARM-001)
  const updateRes = await agent1
    .put("/api/farms/FARM-001")
    .send({ name: "Thửa đồi chè La Bằng VIP", area: 2.80, coordinates: "21.5645, 105.6789" });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.farm.id, "FARM-001");
  assert.equal(updateRes.body.farm.name, "Thửa đồi chè La Bằng VIP");

  // Tenant 2 tries to update Tenant 1's farm -> 403 Forbidden
  const agent2 = request.agent(app);
  await agent2
    .post("/api/login")
    .send({ email: "user2@example.com", password: "Password@123" });

  const crossUpdateRes = await agent2
    .put("/api/farms/FARM-001")
    .send({ name: "Hacker đổi tên", area: 5.0 });

  assert.equal(crossUpdateRes.status, 403);
});

test("T-15: Cross-tenant reading of farms returns 403", async () => {
  const agent1 = request.agent(app);
  await agent1
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  // Read Tenant 2's farm FARM-101 -> 403
  const crossRead = await agent1.get("/api/farms/FARM-101");
  assert.equal(crossRead.status, 403);
});
