const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  seedS22Data,
} = require("../src/server");

test("Story S-47: Người tiêu dùng quét QR truy xuất nguồn gốc nông sản (Jira N2-116)", async (t) => {
  seedS22Data();

  await t.test("N2-225 / N2-280: API sinh mã QR (PNG/SVG) sử dụng URL động, không hardcode localhost", async () => {
    // 1. Tải QR dạng PNG với Host tùy biến
    const resPng = await request(app)
      .get("/api/lots/qrcode/LOT-001?format=png")
      .set("Host", "trace.nongsanviet.gov.vn");

    assert.equal(resPng.status, 200);
    assert.equal(resPng.headers["content-type"], "image/png");
    assert.ok(resPng.headers["content-disposition"].includes("qr-LOT-001.png"));
    assert.ok(resPng.body.length > 500, "Buffer PNG phải có nội dung hợp lệ");

    // 2. Tải QR dạng SVG
    const resSvg = await request(app)
      .get("/api/lots/qrcode/LOT-001?format=svg")
      .set("Host", "agritrace.production.vn");

    assert.equal(resSvg.status, 200);
    assert.ok(resSvg.headers["content-type"].includes("image/svg+xml"));
    const svgContent = resSvg.text || (Buffer.isBuffer(resSvg.body) ? resSvg.body.toString("utf8") : String(resSvg.body));
    assert.ok(svgContent.includes("<svg"), "Phải chứa thẻ SVG");
    assert.ok(resSvg.headers["content-disposition"].includes("qr-LOT-001.svg"));
  });

  await t.test("N2-228: Điều hướng quét QR công khai từ /trace/lots/:lotCode sang /public-trace.html", async () => {
    const res = await request(app).get("/trace/lots/LOT-001");
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/public-trace.html?code=LOT-001");

    const resAlias = await request(app).get("/trace/LOT-002");
    assert.equal(resAlias.status, 302);
    assert.equal(resAlias.headers.location, "/public-trace.html?code=LOT-002");
  });

  await t.test("N2-280 / N2-298: API công khai /api/public/trace/:lotCode trả về đủ vùng trồng và các mốc", async () => {
    const res = await request(app).get("/api/public/trace/LOT-001");
    assert.equal(res.status, 200);
    assert.ok(res.body.lot, "Phải có thông tin đối tượng lot");
    assert.equal(res.body.lot.code, "LOT-001");
    assert.ok(res.body.origins && res.body.origins.length > 0, "Phải có danh sách vùng trồng gốc");
    assert.ok(res.body.journey && res.body.journey.length > 0, "Phải có các mốc hành trình chuỗi");

    // Mốc đầu tiên phải là vùng trồng gốc
    const firstStop = res.body.journey[0];
    assert.equal(firstStop.type, "farm");
    assert.ok(firstStop.title, "Mốc đầu phải có tên vùng trồng");
  });

  await t.test("N2-299: Xử lý lô không tồn tại - trả về HTTP 404 chuẩn, không rò rỉ lỗi hệ thống", async () => {
    const nonExistentCode = "LOT-DOES-NOT-EXIST-999";
    const res = await request(app).get(`/api/public/trace/${nonExistentCode}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "LOT_NOT_FOUND");
    assert.ok(res.body.message.includes(nonExistentCode));

    // Kiểm tra cũng áp dụng cho QR của lô không tồn tại
    const qrRes = await request(app).get(`/api/lots/qrcode/${nonExistentCode}`);
    assert.equal(qrRes.status, 404);
    assert.equal(qrRes.body.error, "LOT_NOT_FOUND");
  });

  await t.test("Bảo mật: Không còn URL localhost:8080 hardcode trong các chuyển hướng server", async () => {
    // Thử truy cập các đường dẫn chuyển hướng HTML
    const loginRes = await request(app).get("/login");
    if (loginRes.status === 302) {
      assert.ok(!loginRes.headers.location.includes("localhost:8080"), "Login không được redirect về localhost:8080");
    }

    const publicTraceRes = await request(app).get("/public-trace");
    if (publicTraceRes.status === 302) {
      assert.ok(!publicTraceRes.headers.location.includes("localhost:8080"), "Public-trace không được redirect về localhost:8080");
    }
  });

  await t.test("Frontend: Kiểm tra tệp lot-detail.html không chứa hardcode localhost:3000 hoặc mặc định LOT-001", () => {
    const lotDetailHtml = fs.readFileSync(path.resolve(__dirname, "../../frontend/lot-detail.html"), "utf8");
    assert.ok(!lotDetailHtml.includes("http://localhost:3000"), "lot-detail.html không được chứa hardcode http://localhost:3000");
    assert.ok(!lotDetailHtml.includes('|| "LOT-001"'), "lot-detail.html không được mặc định ngầm LOT-001");
  });

  await t.test("Frontend: Kiểm tra public-trace.html hỗ trợ hiển thị di động và xử lý lỗi", () => {
    const traceHtml = fs.readFileSync(path.resolve(__dirname, "../../frontend/public-trace.html"), "utf8");
    assert.ok(traceHtml.includes('name="viewport"'), "Phải có thẻ viewport cho di động");
    assert.ok(traceHtml.includes("showAwaitingState"), "Phải có trạng thái chờ quét mã");
    assert.ok(traceHtml.includes("trace-map-fallback"), "Phải có giao diện thông báo khi không tìm thấy lô");
  });
});
