const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, users, inMemoryProducts, inMemoryFarms, seedDemoUser, hashPassword } = require("../src/server");

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Bỏ qua lỗi parse JSON khi body là plain text
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on("error", reject);

    if (body) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

async function loginUser(server, email, password) {
  const port = server.address().port;
  const res = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  );

  const cookie = res.headers["set-cookie"];
  if (!cookie) {
    throw new Error(`Login failed for ${email}`);
  }
  return cookie[0].split(";")[0];
}

test("CSV Import - Products & Farms validation and atomic import", async (t) => {
  await seedDemoUser();

  const adminPasswordHash = await hashPassword("Admin@123");
  users.set("admin@example.com", {
    id: "usr-admin",
    email: "admin@example.com",
    passwordHash: adminPasswordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const adminCookie = await loginUser(server, "admin@example.com", "Admin@123");
  const producerCookie = await loginUser(server, "user@example.com", "Password@123");
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123");

  await t.test("1. Products CSV: Deny unauthorized roles", async () => {
    // Producer cannot import products (only admin)
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/products/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { csvContent: "name,unit\nBắp cải,kg" }
    );
    assert.equal(res.status, 403);

    // Inspector cannot import products (read-only)
    const resInsp = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/products/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: inspectorCookie },
      },
      { csvContent: "name,unit\nBắp cải,kg" }
    );
    assert.equal(resInsp.status, 403);
  });

  await t.test("2. Products CSV: Valid CSV creates all products and reports success count", async () => {
    const initialCount = inMemoryProducts.length;
    const validCsv = "name,unit\nBí đỏ Nhật Bản,kg\nKhoai lang mật,tan\nDưa lưới ruột xanh,thung";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/products/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { csvContent: validCsv }
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.importedCount, 3);
    assert.equal(res.body.products.length, 3);
    assert.equal(inMemoryProducts.length, initialCount + 3);
    assert.ok(inMemoryProducts.some((p) => p.name === "Bí đỏ Nhật Bản" && p.unit === "kg"));
    assert.ok(inMemoryProducts.some((p) => p.name === "Khoai lang mật" && p.unit === "tan"));
    assert.ok(inMemoryProducts.some((p) => p.name === "Dưa lưới ruột xanh" && p.unit === "thung"));
  });

  await t.test("3. Products CSV: One invalid row -> NO row created, report row and column", async () => {
    const initialCount = inMemoryProducts.length;
    // Row 2 is valid, Row 3 has invalid unit 'bao', Row 4 has empty name
    const invalidCsv = "name,unit\nThanh Long ruột đỏ,kg\nỔi ruột hồng,bao\n  ,thung";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/products/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { csvContent: invalidCsv }
    );

    assert.equal(res.status, 400);
    // All-or-Nothing: Không có dòng nào được tạo
    assert.equal(inMemoryProducts.length, initialCount);
    assert.ok(!inMemoryProducts.some((p) => p.name === "Thanh Long ruột đỏ"));

    // Báo cáo lỗi chi tiết dòng và cột
    assert.ok(Array.isArray(res.body.errors));
    assert.equal(res.body.errors.length, 2);

    const errorRow3 = res.body.errors.find((e) => e.row === 3);
    assert.ok(errorRow3);
    assert.equal(errorRow3.column, "unit");
    assert.match(errorRow3.message, /không hợp lệ/);

    const errorRow4 = res.body.errors.find((e) => e.row === 4);
    assert.ok(errorRow4);
    assert.equal(errorRow4.column, "name");
    assert.match(errorRow4.message, /không được để trống/);
  });

  await t.test("4. Products CSV: Duplicate name in file or existing in system -> NO row created", async () => {
    const initialCount = inMemoryProducts.length;
    // 'Cà chua' already seeded, 'Xoài cát' duplicated in file
    const dupCsv = "name,unit\nCà chua,kg\nXoài cát,kg\nXoài cát,tan";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/products/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { csvContent: dupCsv }
    );

    assert.equal(res.status, 400);
    assert.equal(inMemoryProducts.length, initialCount);

    const dupExistingError = res.body.errors.find((e) => e.row === 2);
    assert.ok(dupExistingError);
    assert.equal(dupExistingError.column, "name");
    assert.match(dupExistingError.message, /đã tồn tại/);

    const dupFileError = res.body.errors.find((e) => e.row === 4);
    assert.ok(dupFileError);
    assert.equal(dupFileError.column, "name");
    assert.match(dupFileError.message, /trùng lặp/);
  });

  await t.test("5. Farms CSV: Valid CSV creates all farms and reports success count", async () => {
    const initialFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    const validFarmCsv = "name,area,coordinates\nThửa xoài Cam Lâm 01,3.5,\"12.0123, 109.1234\"\nThửa dưa lưới Vĩnh Hảo 02,1.8,\"11.3456, 108.7890\"";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/farms/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { csvContent: validFarmCsv }
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.importedCount, 2);
    assert.equal(res.body.farms.length, 2);

    const currentFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    assert.equal(currentFarmsCount, initialFarmsCount + 2);
    assert.ok(inMemoryFarms.some((f) => f.name === "Thửa xoài Cam Lâm 01" && f.area === 3.5));
  });

  await t.test("6. Farms CSV: Invalid area or empty name -> NO row created, report row and column", async () => {
    const initialFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    // Row 2 valid, Row 3 area <= 0, Row 4 area NaN, Row 5 empty name
    const invalidFarmCsv = "name,area,coordinates\nThửa chè số 1,2.0,tọa độ\nThửa chè số 2,-1.5,tọa độ\nThửa chè số 3,abc,tọa độ\n  ,4.0,tọa độ";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/farms/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { csvContent: invalidFarmCsv }
    );

    assert.equal(res.status, 400);
    // All-or-nothing check
    const currentFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    assert.equal(currentFarmsCount, initialFarmsCount);
    assert.ok(!inMemoryFarms.some((f) => f.name === "Thửa chè số 1"));

    assert.ok(Array.isArray(res.body.errors));
    assert.equal(res.body.errors.length, 3);

    const errRow3 = res.body.errors.find((e) => e.row === 3);
    assert.ok(errRow3);
    assert.equal(errRow3.column, "area");
    assert.match(errRow3.message, /không hợp lệ/);

    const errRow4 = res.body.errors.find((e) => e.row === 4);
    assert.ok(errRow4);
    assert.equal(errRow4.column, "area");

    const errRow5 = res.body.errors.find((e) => e.row === 5);
    assert.ok(errRow5);
    assert.equal(errRow5.column, "name");
  });

  await t.test("7. Farms CSV: Duplicate name in file or tenant -> NO row created", async () => {
    const initialFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    // 'Thửa đồi chè La Bằng 01' exists in org-001
    const dupFarmCsv = "name,area,coordinates\nThửa đồi chè La Bằng 01,5.0,\nThửa chanh dây mới,2.0,\nThửa chanh dây mới,2.5,";

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/farms/import-csv",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { csvContent: dupFarmCsv }
    );

    assert.equal(res.status, 400);
    const currentFarmsCount = inMemoryFarms.filter((f) => f.organizationId === "org-001").length;
    assert.equal(currentFarmsCount, initialFarmsCount);

    const errRow2 = res.body.errors.find((e) => e.row === 2);
    assert.ok(errRow2);
    assert.equal(errRow2.column, "name");
    assert.match(errRow2.message, /đã tồn tại/);

    const errRow4 = res.body.errors.find((e) => e.row === 4);
    assert.ok(errRow4);
    assert.equal(errRow4.column, "name");
    assert.match(errRow4.message, /trùng lặp/);
  });
});
