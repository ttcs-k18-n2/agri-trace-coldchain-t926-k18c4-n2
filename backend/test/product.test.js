const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, users, seedDemoUser, hashPassword } = require("../src/server");

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

test("T-16 & S-07: Products API lifecycle, permissions, and validation", async (t) => {
  await seedDemoUser();

  // Create an admin user for product creation
  const adminPasswordHash = await hashPassword("Admin@123");
  users.set("admin@example.com", {
    id: "usr-admin",
    email: "admin@example.com",
    passwordHash: adminPasswordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "admin",
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => server.close());

  const producerCookie = await loginUser(server, "user@example.com", "Password@123");
  const adminCookie = await loginUser(server, "admin@example.com", "Admin@123");

  // 1. GET /api/products allows any authenticated user
  const listRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: "/api/products",
    method: "GET",
    headers: { Cookie: producerCookie },
  });
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.products));
  assert.ok(listRes.body.products.length >= 3);

  // 2. POST /api/products by producer returns 403 Forbidden
  const forbiddenRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/products",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: producerCookie },
    },
    { name: "Dưa lưới", unit: "kg" }
  );
  assert.equal(forbiddenRes.status, 403);

  // 3. POST /api/products with empty name returns 400
  const emptyNameRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/products",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { name: "   ", unit: "kg" }
  );
  assert.equal(emptyNameRes.status, 400);

  // 4. POST /api/products with invalid unit returns 400
  const invalidUnitRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/products",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { name: "Xoài Cát Chu", unit: "hop" }
  );
  assert.equal(invalidUnitRes.status, 400);
  assert.match(invalidUnitRes.body.message, /Chỉ chấp nhận: kg, tan, thung/);

  // 5. POST /api/products with valid data creates product (201)
  const createRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/products",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { name: "Khoai tây", unit: "tan" }
  );
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.product.name, "Khoai tây");
  assert.equal(createRes.body.product.unit, "tan");

  // 6. POST duplicate product name (case-insensitive) returns 409 Conflict
  const dupRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/products",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { name: "KHOAI TÂY", unit: "kg" }
  );
  assert.equal(dupRes.status, 409);
});
