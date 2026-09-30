const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, seedDemoUser } = require("../src/server");

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

test("T-20 & S-08: Harvest batch registration API, validation, permissions, and auto-generated lot code", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => server.close());

  // user@example.com is in org-001 (producer)
  const org1Cookie = await loginUser(server, "user@example.com", "Password@123");
  // user2@example.com is in org-002 (cooperative)
  const org2Cookie = await loginUser(server, "user2@example.com", "Password@123");
  // inspector@example.com is inspector
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123");

  // 1. Missing farmId returns 400
  const noFarmRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    { productId: "PROD-TEA", quantity: 100 }
  );
  assert.equal(noFarmRes.status, 400);
  assert.match(noFarmRes.body.message, /Vui lòng chọn thửa đất/);

  // 2. Missing productId returns 400
  const noProductRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    { farmId: "FARM-001", quantity: 100 }
  );
  assert.equal(noProductRes.status, 400);
  assert.match(noProductRes.body.message, /Vui lòng chọn sản phẩm/);

  // 3. Invalid quantity (<= 0 or not a number) returns 400
  const negQtyRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    { farmId: "FARM-001", productId: "PROD-TEA", quantity: -10 }
  );
  assert.equal(negQtyRes.status, 400);
  assert.match(negQtyRes.body.message, /Khối lượng phải là số dương/);

  // 4. Cross-tenant harvest: Org 1 tries to record harvest on Org 2's farm (FARM-101) -> 403 Forbidden
  const crossTenantFarmRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    { farmId: "FARM-101", productId: "PROD-TEA", quantity: 50.5 }
  );
  assert.equal(crossTenantFarmRes.status, 403);
  assert.match(crossTenantFarmRes.body.message, /không có quyền thao tác trên thửa đất/);

  // 5. Inspector attempts to record harvest -> 403 Forbidden (inspectors are read-only)
  const inspectorWriteRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: inspectorCookie },
    },
    { farmId: "FARM-001", productId: "PROD-TEA", quantity: 50.5 }
  );
  assert.equal(inspectorWriteRes.status, 403);

  // 6. Valid harvest registration by Org 1 on own farm (FARM-001) -> 201 Created
  const harvestRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    {
      farmId: "FARM-001",
      productId: "PROD-TEA",
      quantity: 100.5,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(harvestRes.status, 201);
  const createdLot = harvestRes.body.lot;
  assert.ok(createdLot);
  assert.match(createdLot.id, /^LOT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(createdLot.organizationId, "org-001");
  assert.equal(createdLot.farmId, "FARM-001");
  assert.equal(createdLot.productId, "PROD-TEA");
  assert.equal(createdLot.initialQuantity, 100.5);
  assert.equal(createdLot.remainingQuantity, 100.5);
  assert.equal(createdLot.status, "Đã thu hoạch");

  // 7. GET /api/lots by Org 1 returns the newly created lot with product & farm details
  const listRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: "/api/lots",
    method: "GET",
    headers: { Cookie: org1Cookie },
  });
  assert.equal(listRes.status, 200);
  const found = listRes.body.lots.find((l) => l.id === createdLot.id);
  assert.ok(found, `Newly created lot ${createdLot.id} must be in the list`);
  assert.equal(found.initialQuantity, 100.5);

  // 8. Cross-tenant reading: Org 2 tries to read Org 1's newly created lot -> 403 Forbidden
  const crossReadRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: `/api/lots/${createdLot.id}`,
    method: "GET",
    headers: { Cookie: org2Cookie },
  });
  assert.equal(crossReadRes.status, 403);

  // 9. Inspector can read the lot across tenants -> 200 OK
  const inspectorReadRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: `/api/lots/${createdLot.id}`,
    method: "GET",
    headers: { Cookie: inspectorCookie },
  });
  assert.equal(inspectorReadRes.status, 200);
  assert.equal(inspectorReadRes.body.lot.id, createdLot.id);

  // 10. Sequential lot creations all generate valid 8-char codes with retry protection (T-19, T-20)
  for (let i = 0; i < 5; i++) {
    const multiHarvestRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: org1Cookie },
      },
      {
        farmId: "FARM-001",
        productId: "PROD-TEA",
        quantity: 10 + i,
        harvestedAt: "2026-09-30",
      }
    );
    assert.equal(multiHarvestRes.status, 201);
    assert.match(multiHarvestRes.body.lot.id, /^LOT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});
