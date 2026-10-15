const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  seedDemoUser,
  inMemoryTransfers,
} = require("../src/server");

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

test("P0 Security & Express 5 Compatibility: simulate-overdue & backwards-compat lot creation", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const adminCookie = await loginUser(server, "admin@example.com", "Password@123");
  const userCookie = await loginUser(server, "user@example.com", "Password@123");

  await t.test("1. simulate-overdue: Chặn người dùng chưa đăng nhập (401 Unauthorized)", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/simulate-overdue",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { lotId: "LOT-001", hours: 49 }
    );
    assert.equal(res.status, 401);
  });

  await t.test("2. simulate-overdue: Chặn người dùng không có quyền admin (403 Forbidden)", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/simulate-overdue",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
      },
      { lotId: "LOT-001", hours: 49 }
    );
    assert.equal(res.status, 403);
  });

  await t.test("3. simulate-overdue: Admin gọi nhưng không truyền transferId hoặc lotId -> 400 TARGET_REQUIRED", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/simulate-overdue",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { hours: 49 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "TARGET_REQUIRED");
  });

  await t.test("4. simulate-overdue: Bị vô hiệu hóa hoàn toàn trong môi trường production (403 FORBIDDEN)", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const res = await request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/transfers/simulate-overdue",
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: adminCookie },
        },
        { lotId: "LOT-001", hours: 49 }
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "FORBIDDEN");
      assert.match(res.body.message, /production/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  await t.test("5. simulate-overdue: Admin gọi hợp lệ với lotId trong môi trường non-production -> 200 OK", async () => {
    // Tạo 1 transfer PENDING để giả lập
    inMemoryTransfers.push({
      id: "trf-sim-test",
      lotId: "LOT-SIM-01",
      fromOrganizationId: "org-001",
      toOrganizationId: "org-002",
      status: "PENDING",
      isOverdue: false,
      createdAt: new Date().toISOString(),
    });

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/simulate-overdue",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { lotId: "LOT-SIM-01", hours: 50 }
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.transfers);
    assert.equal(res.body.transfers[0].lotId, "LOT-SIM-01");
  });

  await t.test("6. Express 5 Backwards Compatibility: POST /api/organization/lots với farmId & productId gọi handleCreateHarvestLot", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/organization/lots",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
      },
      {
        farmId: "FARM-001",
        productId: "PROD-TOMATO",
        quantity: 250,
        harvestedAt: new Date().toISOString().slice(0, 10),
      }
    );

    assert.equal(res.status, 201);
    assert.ok(res.body.lot);
    assert.equal(res.body.lot.farmId, "FARM-001");
    assert.equal(res.body.lot.productId, "PROD-TOMATO");
    assert.equal(res.body.lot.initialQuantity, 250);
  });
});
