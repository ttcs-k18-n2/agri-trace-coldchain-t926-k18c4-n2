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

  // 1. Missing farmId returns 400 with errors.farmId (T-22)
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
  assert.equal(noFarmRes.body.errors?.farmId, "Vui lòng chọn thửa đất.");

  // 2. Missing productId returns 400 with errors.productId (T-22)
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
  assert.equal(noProductRes.body.errors?.productId, "Vui lòng chọn sản phẩm.");

  // 3. Invalid quantity (<= 0 or not a number) returns 400 with errors.quantity (T-22)
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
  assert.equal(negQtyRes.body.errors?.quantity, "Khối lượng phải là số dương lớn hơn 0.");

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

test("T-21 & S-09: Server-side validation, future date rejection, and idempotency protection", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => server.close());

  const org1Cookie = await loginUser(server, "user@example.com", "Password@123");

  // AC1: Ngày thu hoạch nằm trong tương lai bị chặn tại máy chủ (400)
  const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  const futureRes = await request(
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
      quantity: 50,
      harvestedAt: tomorrow,
    }
  );
  assert.equal(futureRes.status, 400);
  assert.equal(futureRes.body.message, "Ngày thu hoạch không được nằm trong tương lai.");
  assert.equal(futureRes.body.errors?.harvestedAt, "Ngày thu hoạch không được nằm trong tương lai.");

  // AC1: Định dạng ngày thu hoạch không hợp lệ bị chặn (400)
  const invalidDateRes = await request(
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
      quantity: 50,
      harvestedAt: "not-a-valid-date",
    }
  );
  assert.equal(invalidDateRes.status, 400);
  assert.equal(invalidDateRes.body.message, "Ngày thu hoạch không hợp lệ.");
  assert.equal(invalidDateRes.body.errors?.harvestedAt, "Ngày thu hoạch không hợp lệ.");

  // AC2: Khối lượng = 0 bị chặn (400)
  const zeroQtyRes = await request(
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
      quantity: 0,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(zeroQtyRes.status, 400);
  assert.equal(zeroQtyRes.body.message, "Khối lượng phải là số dương lớn hơn 0.");
  assert.equal(zeroQtyRes.body.errors?.quantity, "Khối lượng phải là số dương lớn hơn 0.");

  // AC2: Khối lượng âm (quantity = -5) bị chặn (400)
  const neg5QtyRes = await request(
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
      quantity: -5,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(neg5QtyRes.status, 400);
  assert.equal(neg5QtyRes.body.message, "Khối lượng phải là số dương lớn hơn 0.");
  assert.equal(neg5QtyRes.body.errors?.quantity, "Khối lượng phải là số dương lớn hơn 0.");

  // AC2: Khối lượng không phải số bị chặn (400)
  const nanQtyRes = await request(
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
      quantity: "mười-hai-kg",
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(nanQtyRes.status, 400);
  assert.equal(nanQtyRes.body.message, "Khối lượng phải là số dương lớn hơn 0.");
  assert.equal(nanQtyRes.body.errors?.quantity, "Khối lượng phải là số dương lớn hơn 0.");

  // AC3: Gửi farmId của tổ chức khác (FARM-101 thuộc org-002) bị chặn (403)
  const crossOrgFarmRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    {
      farmId: "FARM-101",
      productId: "PROD-TEA",
      quantity: 50,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(crossOrgFarmRes.status, 403);
  assert.match(crossOrgFarmRes.body.message, /không có quyền thao tác trên thửa đất của tổ chức khác/);

  // AC3: Thửa đất không tồn tại (404)
  const notFoundFarmRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    {
      farmId: "FARM-NON-EXISTENT",
      productId: "PROD-TEA",
      quantity: 50,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(notFoundFarmRes.status, 404);
  assert.equal(notFoundFarmRes.body.message, "Không tìm thấy thửa đất.");

  // AC3: Sản phẩm không tồn tại (400)
  const notFoundProdRes = await request(
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
      productId: "PROD-NON-EXISTENT",
      quantity: 50,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(notFoundProdRes.status, 400);
  assert.equal(notFoundProdRes.body.message, "Sản phẩm không tồn tại trong danh mục.");

  // Chưa đăng nhập (401)
  const unauthRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    {
      farmId: "FARM-001",
      productId: "PROD-TEA",
      quantity: 50,
    }
  );
  assert.equal(unauthRes.status, 401);

  // AC4: Bấm nút lưu 2 lần / Idempotency bảo vệ không sinh 2 lô trùng nhau
  const idempotencyKey = "test-idempotency-" + Date.now();
  const firstReq = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: org1Cookie,
        "X-Idempotency-Key": idempotencyKey,
      },
    },
    {
      farmId: "FARM-001",
      productId: "PROD-TEA",
      quantity: 88.5,
      harvestedAt: "2026-09-29",
    }
  );
  assert.equal(firstReq.status, 201);
  const firstLotId = firstReq.body.lot.id;

  // Gửi lại cùng idempotency key -> máy chủ trả lại kết quả lô trước đó, không sinh lô mới
  const secondReq = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: org1Cookie,
        "X-Idempotency-Key": idempotencyKey,
      },
    },
    {
      farmId: "FARM-001",
      productId: "PROD-TEA",
      quantity: 88.5,
      harvestedAt: "2026-09-29",
    }
  );
  assert.equal(secondReq.status, 201);
  assert.equal(secondReq.body.lot.id, firstLotId);

  // Chống double-click tức thì (cùng thông số trong 1 giây từ cùng user không sinh 2 lô)
  const doubleClickReq1 = await request(
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
      quantity: 99.2,
      harvestedAt: "2026-09-28",
    }
  );
  assert.equal(doubleClickReq1.status, 201);

  const doubleClickReq2 = await request(
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
      quantity: 99.2,
      harvestedAt: "2026-09-28",
    }
  );
  assert.equal(doubleClickReq2.status, 201);
  assert.equal(doubleClickReq2.body.lot.id, doubleClickReq1.body.lot.id);
});

test("T-22 & S-09: Field-level validation error responses and frontend inline error structure", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");

  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const org1Cookie = await loginUser(server, "user@example.com", "Password@123");

  // 1. Multiple missing fields return simultaneous field-level errors
  const bothMissingRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org1Cookie },
    },
    { quantity: -10 }
  );
  assert.equal(bothMissingRes.status, 400);
  assert.ok(bothMissingRes.body.errors);
  assert.equal(bothMissingRes.body.errors.farmId, "Vui lòng chọn thửa đất.");
  assert.equal(bothMissingRes.body.errors.productId, "Vui lòng chọn sản phẩm.");
  assert.equal(bothMissingRes.body.errors.quantity, "Khối lượng phải là số dương lớn hơn 0.");

  // 2. Invalid quantity specifically populates errors.quantity
  const invalidQtyRes = await request(
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
      quantity: 0,
      harvestedAt: "2026-09-30",
    }
  );
  assert.equal(invalidQtyRes.status, 400);
  assert.equal(invalidQtyRes.body.errors?.quantity, "Khối lượng phải là số dương lớn hơn 0.");

  // 3. Frontend harvest.html contains inline error element #error-quantity directly under quantity input
  const harvestHtmlPath = path.resolve(__dirname, "../../frontend/harvest.html");
  const harvestHtml = fs.readFileSync(harvestHtmlPath, "utf-8");
  assert.match(
    harvestHtml,
    /<input[^>]+id="input-quantity"[\s\S]*?<span[^>]+id="error-quantity"[^>]*class="[^"]*error-msg[^"]*"/,
    "harvest.html must contain #error-quantity with error-msg right under quantity input"
  );
  assert.match(
    harvestHtml,
    /createFormErrorHandler/,
    "harvest.html must utilize shared createFormErrorHandler"
  );
  assert.match(
    harvestHtml,
    /submitBtn\.disabled\s*=\s*true/,
    "harvest.html must preserve submit button disabling to prevent double-submit"
  );

  // 4. Frontend farms.html uses shared createFormErrorHandler
  const farmsHtmlPath = path.resolve(__dirname, "../../frontend/farms.html");
  const farmsHtml = fs.readFileSync(farmsHtmlPath, "utf-8");
  assert.match(
    farmsHtml,
    /createFormErrorHandler/,
    "farms.html must utilize shared createFormErrorHandler"
  );

  // 5. app-shell.js exports createFormErrorHandler, showFieldErrors, clearFieldErrors
  const { createFormErrorHandler, showFieldErrors, clearFieldErrors } = require("../../frontend/app-shell");
  assert.equal(typeof createFormErrorHandler, "function");
  assert.equal(typeof showFieldErrors, "function");
  assert.equal(typeof clearFieldErrors, "function");
});


