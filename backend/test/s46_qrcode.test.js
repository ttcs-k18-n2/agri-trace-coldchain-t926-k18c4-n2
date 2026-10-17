const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, inMemoryLots, seedDemoUser } = require("../src/server");

function request(server, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(buffer.toString("utf8"));
        } catch (_) {
          /* ignore json parse failure */
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text: buffer.toString("utf8"),
          json,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("Story S-46 (Jira N2-115): Sinh mã QR cho lô khi đóng gói, tải về tệp in được", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const testLot = {
    id: "LOT-QR-TEST-001",
    name: "Lô bưởi da xanh Bến Tre",
    organizationId: "org-coop-01",
    status: "Đã thu hoạch",
  };
  if (!inMemoryLots.some((l) => l.id === testLot.id)) {
    inMemoryLots.push(testLot);
  }

  await t.test("Backend N2-225: API sinh mã QR PNG hợp lệ cho lô hàng", async () => {
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/qrcode/${testLot.id}?format=png`,
      method: "GET",
    });

    assert.equal(res.status, 200, "Mã phản hồi HTTP phải là 200");
    assert.equal(res.headers["content-type"], "image/png", "Content-Type phải là image/png");
    assert.ok(
      res.headers["content-disposition"] && res.headers["content-disposition"].includes(`qr-${testLot.id}.png`),
      "Phải có header Content-Disposition tải tệp png"
    );

    // PNG signature byte header: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(
      res.buffer.subarray(0, 8).equals(pngSignature),
      "Dữ liệu tải về phải có magic bytes chuẩn PNG hợp lệ"
    );
  });

  await t.test("Backend N2-225: API sinh mã QR SVG hợp lệ cho lô hàng", async () => {
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/qrcode/${testLot.id}?format=svg`,
      method: "GET",
    });

    assert.equal(res.status, 200, "Mã phản hồi HTTP phải là 200");
    assert.ok(
      res.headers["content-type"] && res.headers["content-type"].includes("image/svg+xml"),
      "Content-Type phải là image/svg+xml"
    );
    assert.ok(
      res.headers["content-disposition"] && res.headers["content-disposition"].includes(`qr-${testLot.id}.svg`),
      "Phải có header Content-Disposition tải tệp svg"
    );

    assert.ok(res.text.includes("<svg"), "Nội dung phản hồi phải chứa thẻ <svg");
    assert.ok(res.text.includes("</svg>"), "Nội dung phản hồi phải đóng thẻ </svg>");
  });

  await t.test("Backend N2-225: Kiểm tra validation, lỗi 404 cho lô không tồn tại và 400 cho định dạng sai", async () => {
    // 1. Lô không tồn tại -> 404
    const res404 = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/qrcode/LOT-NON-EXISTENT?format=png",
      method: "GET",
    });
    assert.equal(res404.status, 404, "Lô không tồn tại phải trả về 404");
    assert.equal(res404.json?.error, "LOT_NOT_FOUND");

    // 2. Định dạng không hỗ trợ -> 400
    const res400 = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/lots/qrcode/${testLot.id}?format=pdf`,
      method: "GET",
    });
    assert.equal(res400.status, 400, "Định dạng không được hỗ trợ phải trả về 400");
    assert.equal(res400.json?.error, "INVALID_FORMAT");
  });

  await t.test("Tester N2-226: Điều hướng truy xuất công khai từ /trace/lots/:lotCode", async () => {
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/trace/lots/${testLot.id}`,
      method: "GET",
    });

    assert.equal(res.status, 302, "Phải chuyển hướng 302 về trang truy xuất công khai");
    assert.ok(
      res.headers.location && res.headers.location.includes(`/public-trace.html?code=${testLot.id}`),
      "Đích chuyển hướng phải chứa mã lô công khai, không dùng ID số tự tăng"
    );
  });
});
