/**
 * Test Suite: Story S-50 (Jira N2-119 / Subtask N2-282)
 * "Cache trang công khai và giới hạn tần suất chống dò quét mã lô"
 *
 * Kiểm thử toàn diện:
 * - Cache HIT / MISS và TTL 60 giây
 * - Giới hạn tần suất: > 30 mã lô khác nhau / IP / 60 giây bị chặn (HTTP 429)
 * - Mã lô không tồn tại vẫn tính vào hạn mức
 * - Truy vấn lặp lại cùng mã không tính thêm mã khác
 * - Nhận diện IP khách qua reverse proxy tin cậy, chống giả mạo header X-Forwarded-For
 * - Xử lý nhiều IP độc lập và request đồng thời
 * - Vô hiệu hóa cache ngay lập tức khi mở lệnh thu hồi (không đợi 60 giây)
 * - Bảo đảm an ninh dữ liệu công khai theo chuẩn S-48
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  pool,
  inMemoryLots,
  inMemoryRecallOrders,
  seedS22Data,
  getClientIp,
  getPublicLotCache,
  setPublicLotCache,
  invalidatePublicLotCache,
  defaultInMemoryCache,
  defaultInMemoryRateLimiter,
} = require("../src/server");
const { InMemoryPublicRateLimiter } = require("../src/public_cache_rate_limiter");

function resetS50TestData() {
  seedS22Data();
  inMemoryRecallOrders.length = 0;
  defaultInMemoryCache.clear();
  defaultInMemoryRateLimiter.clear();
}

test("Story S-50: Cache trang công khai và giới hạn tần suất chống dò quét mã lô", async (t) => {
  t.beforeEach(async () => {
    resetS50TestData();
    if (pool) {
      try {
        await pool.query("DELETE FROM public_lot_cache");
        await pool.query("DELETE FROM public_lot_rate_limits");
        await pool.query("DELETE FROM public_blocked_ips");
      } catch {
        /* ignore db cleanup errors in test environments */
      }
    }
  });

  await t.test("TC01: Cache HIT, MISS và TTL 60 giây trên endpoint công khai", async () => {
    // Lần 1: Chưa có cache -> X-Cache: MISS
    const res1 = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res1.status, 200);
    assert.equal(res1.headers["x-cache"], "MISS", "Lần đầu truy xuất phải là cache MISS");
    assert.ok(
      res1.headers["cache-control"]?.includes("max-age=60"),
      "Phải có header Cache-Control: max-age=60"
    );

    // Lần 2: Đã có cache trong vòng 60 giây -> X-Cache: HIT
    const res2 = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res2.status, 200);
    assert.equal(res2.headers["x-cache"], "HIT", "Lần hai truy xuất phải là cache HIT");
    assert.equal(res2.body.lot.code, "LOT-001");
    assert.deepEqual(res2.body.lot.name, res1.body.lot.name);

    // Giả lập hết hạn TTL 60 giây trong in-memory / cache
    const customCache = new Map();
    const now = Date.now();
    await setPublicLotCache({
      pool: null,
      lotCode: "LOT-TTL-TEST",
      payload: { test: "data" },
      ttlSeconds: 60,
      inMemoryCache: customCache,
      now,
    });

    // Trước 60s: còn hạn
    const active = await getPublicLotCache({
      pool: null,
      lotCode: "LOT-TTL-TEST",
      inMemoryCache: customCache,
      now: now + 59000,
    });
    assert.ok(active, "Cache vẫn phải còn hiệu lực tại giây thứ 59");

    // Sau 60s: hết hạn
    const expired = await getPublicLotCache({
      pool: null,
      lotCode: "LOT-TTL-TEST",
      inMemoryCache: customCache,
      now: now + 61000,
    });
    assert.equal(expired, null, "Cache phải hết hiệu lực sau 60 giây");
  });

  await t.test("TC02: Một IP truy vấn quá 30 mã lô khác nhau trong 60s bị chặn tạm thời (HTTP 429)", async () => {
    const testIp = "192.168.10.55";

    // Tạo sẵn 35 mã lô hợp lệ trong in-memory
    for (let i = 1; i <= 35; i++) {
      const code = `LOT-TEST-GEN-${String(i).padStart(3, "0")}`;
      if (!inMemoryLots.some((l) => l.code === code)) {
        inMemoryLots.push({
          id: code,
          code,
          name: `Nông sản mẫu ${i}`,
          status: "Đang lưu kho",
          farmId: "FARM-001",
          farmName: "Hợp tác xã Nông sản An Toàn",
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Gửi 30 request với 30 mã lô KHÁC NHAU từ cùng 1 IP
    for (let i = 1; i <= 30; i++) {
      const code = `LOT-TEST-GEN-${String(i).padStart(3, "0")}`;
      const res = await request(app)
        .get(`/api/public/lots/${code}`)
        .set("X-Forwarded-For", testIp);

      assert.notEqual(res.status, 429, `Mã thứ ${i} chưa vượt hạn mức 30 mã nên không bị 429`);
    }

    // Truy vấn mã thứ 31 khác biệt -> Bị chặn ngay lập tức với HTTP 429
    const blockedRes = await request(app)
      .get("/api/public/lots/LOT-TEST-GEN-031")
      .set("X-Forwarded-For", testIp);

    assert.equal(blockedRes.status, 429, "Truy vấn mã thứ 31 khác biệt phải bị chặn HTTP 429");
    assert.equal(blockedRes.body.error, "TOO_MANY_REQUESTS");
    assert.ok(
      blockedRes.headers["retry-after"] !== undefined,
      "Phải có header Retry-After"
    );
  });

  await t.test("TC03: Mã lô không tồn tại vẫn được tính vào hạn mức chống dò quét", async () => {
    const testIp = "192.168.10.77";

    // Gửi 30 mã không tồn tại khác nhau
    for (let i = 1; i <= 30; i++) {
      const ghostCode = `NONEXIST-${String(i).padStart(4, "0")}`;
      const res = await request(app)
        .get(`/api/public/lots/${ghostCode}`)
        .set("X-Forwarded-For", testIp);

      assert.equal(res.status, 404, `Mã không tồn tại ${ghostCode} phải trả về 404`);
      assert.equal(res.body.error, "LOT_NOT_FOUND");
    }

    // Mã không tồn tại thứ 31 -> Bị chặn với HTTP 429 thay vì 404
    const res31 = await request(app)
      .get("/api/public/lots/NONEXIST-0031")
      .set("X-Forwarded-For", testIp);

    assert.equal(
      res31.status,
      429,
      "Mã không tồn tại thứ 31 phải kích hoạt giới hạn tần suất 429 (mã ảo vẫn tính quota)"
    );
    assert.equal(res31.body.error, "TOO_MANY_REQUESTS");
  });

  await t.test("TC04: Truy vấn lặp lại cùng mã KHÔNG bị tính thành nhiều mã khác nhau", async () => {
    const testIp = "192.168.10.88";

    // Gửi 40 lượt truy vấn lặp đi lặp lại CÙNG MỘT MÃ LOT-001
    for (let i = 1; i <= 40; i++) {
      const res = await request(app)
        .get("/api/public/lots/LOT-001")
        .set("X-Forwarded-For", testIp);

      assert.equal(
        res.status,
        200,
        `Lượt truy vấn thứ ${i} cùng mã LOT-001 không được tính thành nhiều mã khác nhau`
      );
    }
  });

  await t.test("TC05: Nhiều địa chỉ IP hoạt động độc lập, không chặn lây sang IP khác", async () => {
    const ipAttacker = "198.51.100.1";
    const ipNormal = "198.51.100.2";

    // ipAttacker dò quét 31 mã
    for (let i = 1; i <= 31; i++) {
      const code = `SCAN-LOT-${i}`;
      await request(app)
        .get(`/api/public/lots/${code}`)
        .set("X-Forwarded-For", ipAttacker);
    }

    // ipAttacker bị chặn 429
    const attackerRes = await request(app)
      .get("/api/public/lots/LOT-001")
      .set("X-Forwarded-For", ipAttacker);
    assert.equal(attackerRes.status, 429, "Attacker phải bị chặn");

    // ipNormal truy vấn bình thường vẫn thành công (HTTP 200)
    const normalRes = await request(app)
      .get("/api/public/lots/LOT-001")
      .set("X-Forwarded-For", ipNormal);
    assert.equal(normalRes.status, 200, "IP người dùng hợp lệ không bị ảnh hưởng");
  });

  await t.test("TC06: Xác định chính xác IP khách hàng qua proxy tin cậy, chặn giả mạo header", async () => {
    // 1. Kết nối qua reverse proxy nội bộ tin cậy (127.0.0.1) có header X-Forwarded-For hợp lệ
    const reqTrusted = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "203.0.113.195, 10.0.0.1" },
    };
    const clientIp1 = getClientIp(reqTrusted);
    assert.equal(
      clientIp1,
      "203.0.113.195",
      "Phải trích xuất được client IP thực từ header khi kết nối từ proxy tin cậy"
    );

    // 2. Kết nối trực tiếp từ Internet (IP ngoài dải tin cậy) cố tình fake X-Forwarded-For
    const reqUntrusted = {
      socket: { remoteAddress: "198.51.100.50" },
      headers: { "x-forwarded-for": "8.8.8.8" }, // Kẻ tấn công giả mạo header
    };
    const clientIp2 = getClientIp(reqUntrusted, ["127.0.0.1", "::1"]);
    assert.equal(
      clientIp2,
      "198.51.100.50",
      "Tuyệt đối không tin tưởng header giả mạo từ kết nối trực tiếp không thuộc proxy tin cậy"
    );
  });

  await t.test("TC07: Xử lý an toàn khi có nhiều request đồng thời (Concurrency)", async () => {
    const testIp = "192.168.20.10";
    const limiter = new InMemoryPublicRateLimiter();

    // Bắn 25 request đồng thời cho 25 mã khác nhau
    const tasks = [];
    for (let i = 1; i <= 25; i++) {
      tasks.push(
        Promise.resolve().then(() =>
          limiter.checkAndRecord({
            clientIp: testIp,
            lotCode: `CONCURRENT-LOT-${i}`,
          })
        )
      );
    }

    const results = await Promise.all(tasks);
    const allowedCount = results.filter((r) => r.allowed).length;
    assert.equal(allowedCount, 25, "Toàn bộ 25 request đồng thời dưới ngưỡng 30 phải được chấp nhận");

    // Bắn tiếp 10 request đồng thời vượt ngưỡng
    const extraTasks = [];
    for (let i = 26; i <= 35; i++) {
      extraTasks.push(
        Promise.resolve().then(() =>
          limiter.checkAndRecord({
            clientIp: testIp,
            lotCode: `CONCURRENT-LOT-${i}`,
          })
        )
      );
    }

    const extraResults = await Promise.all(extraTasks);
    const blockedCount = extraResults.filter((r) => !r.allowed).length;
    assert.ok(blockedCount > 0, "Các request vượt ngưỡng phải bị chặn đồng thời một cách an toàn");
  });

  await t.test("TC08: Vô hiệu hóa cache ngay lập tức khi mở lệnh thu hồi (không đợi 60 giây)", async () => {
    // 1. Lần đầu truy vấn LOT-001 (lô sạch bình thường) -> cache được tạo
    const resClean = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(resClean.status, 200);
    assert.equal(resClean.body.lot.recall.isRecalled, false);
    assert.equal(resClean.headers["x-cache"], "MISS");

    // 2. Lần thứ hai trong vòng 60s -> cache HIT
    const resCached = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(resCached.status, 200);
    assert.equal(resCached.headers["x-cache"], "HIT");

    // 3. Mở lệnh thu hồi khẩn cấp cho LOT-001 và kích hoạt vô hiệu hóa cache
    inMemoryRecallOrders.push({
      id: "RC-EMERGENCY-001",
      lotId: "LOT-001",
      reason: "Phát hiện tồn dư vi sinh khẩn cấp",
      severity: "CRITICAL",
      status: "OPEN",
      createdBy: "qc-admin@agritrace.vn",
      createdAt: new Date().toISOString(),
    });

    await invalidatePublicLotCache({
      pool,
      lotCodes: ["LOT-001"],
      lotIds: ["LOT-001"],
      inMemoryCache: defaultInMemoryCache,
    });

    // 4. Truy vấn lại ngay lập tức (không đợi 60 giây)
    const resRecalled = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(resRecalled.status, 200);
    assert.equal(
      resRecalled.body.lot.recall.isRecalled,
      true,
      "Cache cũ phải bị vô hiệu hóa ngay, phản hồi mới phải hiển thị cảnh báo thu hồi"
    );
    assert.equal(resRecalled.body.lot.safetyStatus, "RECALLED");
  });

  await t.test("TC09: Phản hồi công khai tuân thủ tuyệt đối danh mục cho phép S-48, không lộ dữ liệu nội bộ", async () => {
    const res = await request(app).get("/api/public/lots/LOT-001");
    assert.equal(res.status, 200);

    const jsonStr = JSON.stringify(res.body);
    // Không chứa các từ khóa nhạy cảm nội bộ
    assert.ok(!jsonStr.includes("internalNote"), "Không chứa internalNote");
    assert.ok(!jsonStr.includes("driverPhone"), "Không chứa driverPhone");
    assert.ok(!jsonStr.includes("licensePlate"), "Không chứa licensePlate");
    assert.ok(!jsonStr.includes("price"), "Không chứa price");
    assert.ok(!jsonStr.includes("cost"), "Không chứa cost");
    assert.ok(!jsonStr.includes("secret"), "Không chứa secret");
  });
});
