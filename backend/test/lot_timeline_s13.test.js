/**
 * Test Suite cho Jira Story N2-78 / S-13: Xem dòng thời gian sự kiện của một lô
 *
 * Kiểm tra đầy đủ 4 điều kiện nghiệm thu (Acceptance Criteria):
 * 1. Nhiều sự kiện -> trả về đúng thứ tự thời gian (sequenceNo 1, 2, 3...), kèm đúng tên tổ chức thực hiện.
 * 2. Lô chỉ có 1 sự kiện -> vẫn hiển thị và phản hồi bình thường.
 * 3. Chuỗi bị lỗi toàn vẹn (can thiệp sửa/xóa event) -> isIntegrityValid = false và có chi tiết lỗi để UI hiện cảnh báo.
 * 4. Hiệu năng: Lô có 200 sự kiện -> truy vấn getBatchEvents < 200 ms (T-31) và endpoint < 2000 ms.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  seedDemoUser,
  inMemoryLots,
} = require("../src/server");
const { appendBatchEvent, getBatchEvents } = require("../src/event_repository");

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
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

test("S-13 / N2-78: Xem dòng thời gian sự kiện của một lô hàng", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  // Đăng nhập tài khoản Org 1 (cooperative)
  const authCookie = await loginUser(server, "user@example.com", "Password@123");
  assert.ok(authCookie, "Đăng nhập thành công và có cookie session");

  // AC 1: Nhiều sự kiện -> trả về đúng thứ tự thời gian và đúng tên tổ chức (T-31)
  await t.test("1. AC1 & T-31: Trả về danh sách sự kiện đúng thứ tự và có tên tổ chức", async () => {
    const lotId = "LOT-S13-MULTI";
    inMemoryLots.push({
      id: lotId,
      name: "Lô cà chua Thái Nguyên S13",
      organizationId: "org-001",
      status: "Đang vận chuyển",
    });

    // 1.1 Khởi tạo 3 sự kiện liên tiếp
    await appendBatchEvent(null, {
      batchId: lotId,
      eventType: "HARVEST_CREATED",
      payload: { productName: "Cà chua VietGAP", quantity: 100 },
      organizationId: "org-001",
      organizationName: "Nông trại Xanh (Org 1)",
      actorUserId: "usr-001",
      occurredAt: new Date(Date.now() - 3600000),
    });

    await appendBatchEvent(null, {
      batchId: lotId,
      eventType: "TRANSFER_INITIATED",
      payload: { toOrganizationId: "org-002", toOrganizationName: "HTX Chế biến Nông sản (Org 2)" },
      organizationId: "org-001",
      organizationName: "Nông trại Xanh (Org 1)",
      actorUserId: "usr-001",
      occurredAt: new Date(Date.now() - 1800000),
    });

    await appendBatchEvent(null, {
      batchId: lotId,
      eventType: "TRANSFER_CONFIRMED",
      payload: { fromOrganizationId: "org-001", toOrganizationId: "org-002" },
      organizationId: "org-002",
      organizationName: "HTX Chế biến Nông sản (Org 2)",
      actorUserId: "usr-002",
      occurredAt: new Date(),
    });

    // 1.2 Gọi GET /api/lots/:id/events
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/${lotId}/events`,
      method: "GET",
      headers: { Cookie: authCookie },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 3);
    assert.equal(res.body.isIntegrityValid, true);

    const events = res.body.events;
    // Kiểm tra thứ tự tuần tự
    assert.equal(events[0].sequenceNo, 1);
    assert.equal(events[1].sequenceNo, 2);
    assert.equal(events[2].sequenceNo, 3);

    // Kiểm tra có tên tổ chức thực hiện
    assert.ok(events[0].organizationName, "Event 1 phải có organizationName");
    assert.equal(events[0].organizationName, "Nông trại Xanh (Org 1)");
    assert.equal(events[2].organizationName, "HTX Chế biến Nông sản (Org 2)");

    // 1.3 Endpoint /api/lots/:id/timeline cũng phải hoạt động tương tự
    const timelineRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/${lotId}/timeline`,
      method: "GET",
      headers: { Cookie: authCookie },
    });
    assert.equal(timelineRes.status, 200);
    assert.equal(timelineRes.body.count, 3);
    assert.equal(timelineRes.body.isIntegrityValid, true);
  });

  // AC 2: Lô chỉ có 1 sự kiện -> vẫn hiển thị bình thường
  await t.test("2. AC2: Lô chỉ có 1 sự kiện thu hoạch duy nhất vẫn phản hồi đầy đủ", async () => {
    const singleLotId = "LOT-S13-SINGLE";
    inMemoryLots.push({
      id: singleLotId,
      name: "Lô chè Tân Cương 1 sự kiện",
      organizationId: "org-001",
      status: "Đang lưu kho",
    });

    await appendBatchEvent(null, {
      batchId: singleLotId,
      eventType: "HARVEST_CREATED",
      payload: { productName: "Chè Tân Cương", quantity: 50 },
      organizationId: "org-001",
      organizationName: "Nông trại Xanh (Org 1)",
      actorUserId: "usr-001",
    });

    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/${singleLotId}/events`,
      method: "GET",
      headers: { Cookie: authCookie },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.events[0].sequenceNo, 1);
    assert.equal(res.body.events[0].eventType, "HARVEST_CREATED");
    assert.equal(res.body.events[0].organizationName, "Nông trại Xanh (Org 1)");
    assert.equal(res.body.isIntegrityValid, true);
  });

  // AC 3: Chuỗi bị lỗi toàn vẹn -> isIntegrityValid = false và có integrityError
  await t.test("3. AC3: Phát hiện lỗi toàn vẹn khi sự kiện bị can thiệp trái phép", async () => {
    const tamperedLotId = "LOT-S13-TAMPERED";
    inMemoryLots.push({
      id: tamperedLotId,
      name: "Lô bị sửa lén",
      organizationId: "org-001",
      status: "Đang vận chuyển",
    });

    const ev1 = await appendBatchEvent(null, {
      batchId: tamperedLotId,
      eventType: "HARVEST_CREATED",
      payload: { quantity: 100 },
      organizationId: "org-001",
      actorUserId: "usr-001",
    });

    await appendBatchEvent(null, {
      batchId: tamperedLotId,
      eventType: "TEMPERATURE_LOGGED",
      payload: { temperatureC: 4.5 },
      organizationId: "org-001",
      actorUserId: "usr-001",
    });

    // Giả lập kẻ xấu sửa lén payload của ev1 mà không cập nhật event_hash
    ev1.payload = { quantity: 999999 }; // Bị tampered

    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/${tamperedLotId}/events`,
      method: "GET",
      headers: { Cookie: authCookie },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.isIntegrityValid, false, "Phải phát hiện vi phạm toàn vẹn dữ liệu");
    assert.ok(res.body.integrityError, "Phải trả về thông báo lỗi vi phạm");
    assert.equal(res.body.integrityDetails.type, "CONTENT_TAMPERED");
    assert.equal(res.body.integrityDetails.firstInvalidSequence, 1);
  });

  // AC 4 & T-31: Hiệu năng với 200 sự kiện -> query < 200 ms, toàn bộ endpoint < 2000 ms
  await t.test("4. AC4 & T-31: Kiểm thử hiệu năng với 200 sự kiện liên tiếp", async () => {
    const perfLotId = "LOT-S13-PERF200";
    inMemoryLots.push({
      id: perfLotId,
      name: "Lô đo benchmark 200 sự kiện",
      organizationId: "org-001",
      status: "Đang vận chuyển",
    });

    // Tạo 200 sự kiện cho lô này
    for (let i = 1; i <= 200; i++) {
      await appendBatchEvent(null, {
        batchId: perfLotId,
        eventType: i === 1 ? "HARVEST_CREATED" : "TEMPERATURE_LOGGED",
        payload: { reading: i, temp: 4.0 + (i % 3) * 0.1 },
        organizationId: "org-001",
        actorUserId: "usr-001",
        occurredAt: new Date(Date.now() - (200 - i) * 60000),
      });
    }

    // Đo tốc độ hàm truy vấn getBatchEvents (T-31: mục tiêu < 200 ms)
    const t0Query = performance.now();
    const queriedEvents = await getBatchEvents(null, perfLotId);
    const queryDuration = performance.now() - t0Query;

    assert.equal(queriedEvents.length, 200);
    assert.ok(
      queryDuration < 200,
      `Truy vấn getBatchEvents phải dưới 200 ms (thực tế: ${queryDuration.toFixed(2)} ms)`
    );

    // Đo tốc độ gọi toàn bộ endpoint /api/lots/:id/events (mục tiêu < 2000 ms)
    const t0Api = performance.now();
    const perfRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/${perfLotId}/events`,
      method: "GET",
      headers: { Cookie: authCookie },
    });
    const apiDuration = performance.now() - t0Api;

    assert.equal(perfRes.status, 200);
    assert.equal(perfRes.body.count, 200);
    assert.equal(perfRes.body.isIntegrityValid, true);
    assert.ok(
      apiDuration < 2000,
      `Endpoint tải 200 sự kiện phải dưới 2 giây (thực tế: ${apiDuration.toFixed(2)} ms)`
    );
  });

  // 5. Kiểm tra mã nguồn giao diện lot-detail.html đáp ứng T-32
  await t.test("5. T-32: Giao diện lot-detail.html chứa đầy đủ thành phần dòng thời gian và cảnh báo", () => {
    const htmlPath = path.resolve(__dirname, "../../frontend/lot-detail.html");
    const html = fs.readFileSync(htmlPath, "utf8");

    // Kiểm tra có cơ chế hiển thị tên tổ chức
    assert.ok(html.includes("organizationName"), "lot-detail.html phải hiển thị organizationName");

    // Kiểm tra có banner cảnh báo toàn vẹn
    assert.ok(html.includes("integrityAlertBanner"), "lot-detail.html phải có integrityAlertBanner");
    assert.ok(html.includes("isIntegrityValid"), "lot-detail.html phải kiểm tra cờ isIntegrityValid");
    assert.ok(html.includes("integrityError"), "lot-detail.html phải hiển thị integrityError");

    // Kiểm tra có huy hiệu chuỗi toàn vẹn
    assert.ok(html.includes("Chuỗi toàn vẹn (SHA-256)"), "lot-detail.html phải có huy hiệu chuỗi toàn vẹn");
  });
});
