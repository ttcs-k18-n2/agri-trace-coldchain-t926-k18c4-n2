const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  seedDemoUser,
  inMemoryLots,
  inMemoryBatchEvents,
  setAppendHookForTesting,
  GENESIS_HASH,
  canonicalize,
  calculateEventHash,
  appendBatchEvent,
  getBatchEvents,
  verifyBatchEventChain,
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

test("S-10 Core: Canonical JSON and Deterministic Hash calculation (RFC 8785)", async () => {
  // 1. Genesis hash is 64 zeros
  assert.equal(GENESIS_HASH, "0".repeat(64));
  assert.equal(GENESIS_HASH.length, 64);

  // 2. Hai object có thứ tự key khác nhau phải cho ra cùng canonical string và event_hash
  const obj1 = { b: 2, a: 1 };
  const obj2 = { a: 1, b: 2 };
  assert.equal(canonicalize(obj1), '{"a":1,"b":2}');
  assert.equal(canonicalize(obj2), '{"a":1,"b":2}');

  const hash1 = calculateEventHash(GENESIS_HASH, obj1);
  const hash2 = calculateEventHash(GENESIS_HASH, obj2);
  assert.equal(hash1, hash2, "Mã băm phải giống hệt nhau bất kể thứ tự key trong JSON");

  // 3. Nested objects with different key ordering
  const complex1 = {
    quantity: 100,
    metadata: { z: "end", a: "start" },
    farmId: "FARM-001",
  };
  const complex2 = {
    farmId: "FARM-001",
    quantity: 100,
    metadata: { a: "start", z: "end" },
  };
  assert.equal(
    canonicalize(complex1),
    '{"farmId":"FARM-001","metadata":{"a":"start","z":"end"},"quantity":100}'
  );
  assert.equal(
    calculateEventHash(GENESIS_HASH, complex1),
    calculateEventHash(GENESIS_HASH, complex2)
  );
});

test("S-10 Core: Hash chain verification and tampering detection", async () => {
  const testBatchId = "BATCH-TEST-CHAIN";
  inMemoryBatchEvents.length = 0;

  // Event #1: Genesis
  const event1 = await appendBatchEvent(null, {
    batchId: testBatchId,
    eventType: "HARVEST_CREATED",
    payload: { farmId: "FARM-001", productId: "PROD-TEA", quantity: 100 },
    organizationId: "org-001",
  });
  assert.equal(event1.sequenceNo, 1);
  assert.equal(event1.previousHash, GENESIS_HASH);

  // Event #2: Sequential
  const event2 = await appendBatchEvent(null, {
    batchId: testBatchId,
    eventType: "QUALITY_INSPECTED",
    payload: { grade: "A", passed: true },
    organizationId: "org-001",
  });
  assert.equal(event2.sequenceNo, 2);
  assert.equal(event2.previousHash, event1.eventHash);

  // Verify intact chain
  const events = await getBatchEvents(null, testBatchId);
  assert.equal(events.length, 2);
  const verifyRes = verifyBatchEventChain(events);
  assert.equal(verifyRes.valid, true);

  // Tampering detection: if payload is secretly altered
  const tamperedEvents = JSON.parse(JSON.stringify(events));
  tamperedEvents[0].payload.quantity = 9999; // Giả mạo số lượng
  const tamperedCheck = verifyBatchEventChain(tamperedEvents);
  assert.equal(tamperedCheck.valid, false);
  assert.match(tamperedCheck.error, /tampered/);
});

test("S-10 Integration: Lot creation emits HARVEST_CREATED event with Genesis Hash in atomic transaction", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => server.close());

  const org1Cookie = await loginUser(server, "user@example.com", "Password@123");
  const org2Cookie = await loginUser(server, "user2@example.com", "Password@123");
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123");

  // 1. Tạo lô thu hoạch mới
  const createRes = await request(
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
      quantity: 150,
      harvestedAt: "2026-10-01",
    }
  );

  assert.equal(createRes.status, 201);
  const createdLot = createRes.body.lot;
  assert.ok(createdLot);
  assert.ok(createdLot.id);

  // 2. Kiểm tra event trả về trong response
  const eventInRes = createRes.body.event;
  assert.ok(eventInRes);
  assert.equal(eventInRes.eventType, "HARVEST_CREATED");
  assert.equal(eventInRes.sequenceNo, 1);
  assert.equal(eventInRes.previousHash, GENESIS_HASH);
  assert.ok(eventInRes.eventHash);
  assert.equal(eventInRes.eventHash.length, 64);

  // 3. Gọi endpoint GET /api/lots/:id/events để đọc danh sách sự kiện
  const getEventsRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: `/api/lots/${createdLot.id}/events`,
    method: "GET",
    headers: { Cookie: org1Cookie },
  });

  assert.equal(getEventsRes.status, 200);
  assert.equal(getEventsRes.body.count, 1);
  assert.equal(getEventsRes.body.isIntegrityValid, true);
  const firstEvent = getEventsRes.body.events[0];
  assert.equal(firstEvent.eventType, "HARVEST_CREATED");
  assert.equal(firstEvent.sequenceNo, 1);
  assert.equal(firstEvent.previousHash, GENESIS_HASH);

  // 4. Quyền truy cập: Tổ chức khác (org-002) đọc events của lô org-001 bị chặn 403
  const crossEventsRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: `/api/lots/${createdLot.id}/events`,
    method: "GET",
    headers: { Cookie: org2Cookie },
  });
  assert.equal(crossEventsRes.status, 403);

  // 5. Cán bộ kiểm tra (Inspector) đọc được events của lô hàng (200)
  const inspectorEventsRes = await request(server, {
    hostname: "127.0.0.1",
    port,
    path: `/api/lots/${createdLot.id}/events`,
    method: "GET",
    headers: { Cookie: inspectorCookie },
  });
  assert.equal(inspectorEventsRes.status, 200);
  assert.equal(inspectorEventsRes.body.count, 1);
  assert.equal(inspectorEventsRes.body.isIntegrityValid, true);
});

test("S-10 Transaction Atomicity: Rollback lot when event append fails (no lot left behind)", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    setAppendHookForTesting(null);
    server.close();
  });

  const org1Cookie = await loginUser(server, "user@example.com", "Password@123");
  const initialLotCount = inMemoryLots.length;

  // Kích hoạt mô phỏng lỗi khi appendBatchEvent: ném Exception
  setAppendHookForTesting(() => {
    throw new Error("Lỗi giả lập: Không thể kết nối hoặc ghi hash event vào lưu trữ.");
  });

  // Thực hiện gọi POST /api/lots
  const failedCreateRes = await request(
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
      quantity: 200,
      harvestedAt: "2026-10-02",
    }
  );

  // Máy chủ phải trả về lỗi 500
  assert.equal(failedCreateRes.status, 500);
  assert.match(failedCreateRes.body.message, /Lỗi ghi nhận chuỗi sự kiện/);

  // Quan trọng nhất: Lô KHÔNG được phép tồn tại trong inMemoryLots (hoàn tác rollback hoàn toàn)
  assert.equal(
    inMemoryLots.length,
    initialLotCount,
    "Số lượng lô không được tăng khi ghi event thất bại (phải rollback toàn bộ)"
  );

  // Dọn dẹp hook
  setAppendHookForTesting(null);

  // Sau khi gỡ hook, việc tạo lô lại thành công bình thường
  const normalCreateRes = await request(
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
      quantity: 200,
      harvestedAt: "2026-10-02",
    }
  );
  assert.equal(normalCreateRes.status, 201);
  assert.equal(inMemoryLots.length, initialLotCount + 1);
});
