/**
 * Module quản lý Cache và Giới hạn tần suất truy xuất công khai (Story S-50 / Jira N2-119 / N2-282)
 *
 * Tiêu chí đáp ứng:
 * 1. Cache kết quả trang/API công khai trong 60 giây.
 * 2. Một IP gọi quá 30 mã lô khác nhau trong 60 giây bị chặn tạm (HTTP 429).
 * 3. Mã lô không tồn tại vẫn tính vào hạn mức.
 * 4. Truy vấn lặp lại cùng mã không tính thêm mã khác.
 * 5. Xác định chính xác IP qua reverse proxy tin cậy, không tin mù quáng header giả mạo.
 * 6. Vô hiệu hóa cache ngay lập tức khi lô bị mở lệnh thu hồi (S-49).
 * 7. Hoạt động an toàn với nhiều instance và nhiều request đồng thời qua PostgreSQL.
 */

const net = require("net");

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_DISTINCT_LOTS = 30;
const RATE_LIMIT_BLOCK_DURATION_SECONDS = 60;
const CACHE_TTL_SECONDS = 60;

/**
 * Danh sách mạng/IP proxy nội bộ tin cậy mặc định
 */
const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
];

/**
 * Chuẩn hóa địa chỉ IP (bỏ tiền tố ::ffff: cho IPv4-mapped IPv6)
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return "127.0.0.1";
  const trimmed = ip.trim();
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.substring(7);
  }
  return trimmed;
}

/**
 * Kiểm tra IP có thuộc danh sách proxy tin cậy hay không
 */
function isTrustedProxy(ip, customTrustedList = null) {
  const norm = normalizeIp(ip);
  const trustedList = Array.isArray(customTrustedList) && customTrustedList.length > 0
    ? customTrustedList
    : (process.env.TRUSTED_PROXIES ? process.env.TRUSTED_PROXIES.split(",").map((s) => normalizeIp(s)) : DEFAULT_TRUSTED_PROXIES);

  if (trustedList.includes(norm)) return true;

  // Hỗ trợ cấu hình TRUST_PROXY=true cho môi trường docker/staging có subnet riêng
  if (process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1") {
    // Kiểm tra dải private RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) hoặc loopback
    if (
      norm.startsWith("10.") ||
      norm.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(norm) ||
      norm === "127.0.0.1" ||
      norm === "::1"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Trích xuất an toàn địa chỉ IP của client thực tế:
 * - Nếu kết nối trực tiếp đến từ IP proxy tin cậy: đọc client IP từ header X-Forwarded-For (ưu tiên IP ngoài cùng bên trái hợp lệ).
 * - Nếu kết nối đến từ IP KHÔNG tin cậy (trực tiếp từ Internet / attacker): tuyệt đối BỎ QUA X-Forwarded-For và dùng socket.remoteAddress.
 */
function getClientIp(req, customTrustedList = null) {
  const socketIp = normalizeIp(
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.ip ||
    "127.0.0.1"
  );

  const directPeerTrusted = isTrustedProxy(socketIp, customTrustedList);

  if (!directPeerTrusted) {
    // Không tin tưởng header từ kết nối trực tiếp không nằm trong proxy allowlist
    return socketIp;
  }

  // Kết nối đến từ proxy tin cậy -> đọc X-Forwarded-For
  const xForwardedFor = req.headers?.["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim().length > 0) {
    const rawIps = xForwardedFor.split(",").map((s) => normalizeIp(s));
    // Tìm IP hợp lệ đầu tiên không phải là proxy nội bộ
    for (const cand of rawIps) {
      if (net.isIP(cand)) {
        return cand;
      }
    }
  }

  const xRealIp = req.headers?.["x-real-ip"];
  if (typeof xRealIp === "string" && net.isIP(normalizeIp(xRealIp))) {
    return normalizeIp(xRealIp);
  }

  return socketIp;
}

/**
 * Bộ nhớ tạm (In-memory) phục vụ Fallback và Unit Test không cần PostgreSQL
 */
class InMemoryPublicRateLimiter {
  constructor() {
    this.records = new Map(); // ip -> { queries: Map<lotCode, timestamp>, blockedUntil: number }
  }

  checkAndRecord({ clientIp, lotCode, now = Date.now() }) {
    const normIp = normalizeIp(clientIp);
    const code = String(lotCode || "").trim().toUpperCase();

    let record = this.records.get(normIp);
    if (!record) {
      record = { queries: new Map(), blockedUntil: 0 };
      this.records.set(normIp, record);
    }

    // 1. Kiểm tra xem IP có đang bị chặn hay không
    if (record.blockedUntil > 0) {
      if (now < record.blockedUntil) {
        const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
        return {
          allowed: false,
          retryAfter: retryAfter > 0 ? retryAfter : 1,
          blocked: true,
          distinctCount: record.queries.size,
        };
      }
      // Hết thời hạn chặn -> reset
      record.blockedUntil = 0;
      record.queries.clear();
    }

    // 2. Dọn dẹp các mã đã truy vấn quá cửa sổ 60s
    const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;
    for (const [c, timestamp] of record.queries.entries()) {
      if (timestamp < windowStart) {
        record.queries.delete(c);
      }
    }

    // 3. Nếu đã truy vấn quá hạn mức trước đó trong cửa sổ
    if (record.queries.size >= RATE_LIMIT_MAX_DISTINCT_LOTS && !record.queries.has(code)) {
      record.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION_SECONDS * 1000;
      return {
        allowed: false,
        retryAfter: RATE_LIMIT_BLOCK_DURATION_SECONDS,
        blocked: true,
        distinctCount: record.queries.size + 1,
      };
    }

    // 4. Ghi nhận mã lô (nếu đã có thì chỉ cập nhật thời gian, không tăng distinct)
    record.queries.set(code, now);

    // 5. Kiểm tra lại số lượng distinct
    if (record.queries.size > RATE_LIMIT_MAX_DISTINCT_LOTS) {
      record.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION_SECONDS * 1000;
      return {
        allowed: false,
        retryAfter: RATE_LIMIT_BLOCK_DURATION_SECONDS,
        blocked: true,
        distinctCount: record.queries.size,
      };
    }

    return {
      allowed: true,
      distinctCount: record.queries.size,
    };
  }

  clear() {
    this.records.clear();
  }
}

const defaultInMemoryRateLimiter = new InMemoryPublicRateLimiter();
const defaultInMemoryCache = new Map(); // lotCode -> { payload, expiresAt }

/**
 * Kiểm tra và ghi nhận giới hạn tần suất truy vấn mã lô (chống dò quét)
 */
async function checkPublicLotRateLimit({
  pool,
  clientIp,
  lotCode,
  inMemoryLimiter = defaultInMemoryRateLimiter,
  now = new Date(),
}) {
  const normIp = normalizeIp(clientIp);
  const code = String(lotCode || "").trim().toUpperCase();
  const currentTimestamp = now instanceof Date ? now : new Date(now);

  if (!pool) {
    return inMemoryLimiter.checkAndRecord({
      clientIp: normIp,
      lotCode: code,
      now: currentTimestamp.getTime(),
    });
  }

  try {
    // 1. Kiểm tra IP có đang bị chặn trong PostgreSQL
    const blockCheck = await pool.query(
      `SELECT blocked_until FROM public_blocked_ips WHERE client_ip = $1 AND blocked_until > $2`,
      [normIp, currentTimestamp]
    );

    if (blockCheck.rows.length > 0) {
      const blockedUntil = new Date(blockCheck.rows[0].blocked_until);
      const retryAfter = Math.max(
        1,
        Math.ceil((blockedUntil.getTime() - currentTimestamp.getTime()) / 1000)
      );
      return {
        allowed: false,
        retryAfter,
        blocked: true,
      };
    }

    // 2. Đếm số lượng mã lô khác nhau đã truy vấn trong 60 giây qua
    const windowStart = new Date(currentTimestamp.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT lot_code)::int AS count
       FROM public_lot_rate_limits
       WHERE client_ip = $1 AND requested_at >= $2`,
      [normIp, windowStart]
    );

    const currentDistinct = countRes.rows[0]?.count || 0;

    // Kiểm tra xem mã này đã từng được IP gọi trong cửa sổ chưa
    const codeCheck = await pool.query(
      `SELECT 1 FROM public_lot_rate_limits
       WHERE client_ip = $1 AND lot_code = $2 AND requested_at >= $3 LIMIT 1`,
      [normIp, code, windowStart]
    );
    const codeAlreadyQueried = codeCheck.rows.length > 0;

    // Nếu đã đủ 30 mã và truy vấn một mã mới thứ 31 -> Chặn ngay
    if (currentDistinct >= RATE_LIMIT_MAX_DISTINCT_LOTS && !codeAlreadyQueried) {
      const blockedUntil = new Date(
        currentTimestamp.getTime() + RATE_LIMIT_BLOCK_DURATION_SECONDS * 1000
      );
      await pool.query(
        `INSERT INTO public_blocked_ips (client_ip, blocked_until)
         VALUES ($1, $2)
         ON CONFLICT (client_ip) DO UPDATE
         SET blocked_until = GREATEST(public_blocked_ips.blocked_until, EXCLUDED.blocked_until)`,
        [normIp, blockedUntil]
      );
      return {
        allowed: false,
        retryAfter: RATE_LIMIT_BLOCK_DURATION_SECONDS,
        blocked: true,
        distinctCount: currentDistinct + 1,
      };
    }

    // 3. Ghi nhận vào bảng rate limits
    await pool.query(
      `INSERT INTO public_lot_rate_limits (client_ip, lot_code, requested_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [
        normIp,
        code,
        currentTimestamp,
        new Date(currentTimestamp.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000),
      ]
    );

    // Tính lại distinct sau khi thêm
    const finalDistinct = codeAlreadyQueried ? currentDistinct : currentDistinct + 1;

    if (finalDistinct > RATE_LIMIT_MAX_DISTINCT_LOTS) {
      const blockedUntil = new Date(
        currentTimestamp.getTime() + RATE_LIMIT_BLOCK_DURATION_SECONDS * 1000
      );
      await pool.query(
        `INSERT INTO public_blocked_ips (client_ip, blocked_until)
         VALUES ($1, $2)
         ON CONFLICT (client_ip) DO UPDATE
         SET blocked_until = GREATEST(public_blocked_ips.blocked_until, EXCLUDED.blocked_until)`,
        [normIp, blockedUntil]
      );
      return {
        allowed: false,
        retryAfter: RATE_LIMIT_BLOCK_DURATION_SECONDS,
        blocked: true,
        distinctCount: finalDistinct,
      };
    }

    return {
      allowed: true,
      distinctCount: finalDistinct,
    };
  } catch (err) {
    console.error("[PostgresPublicRateLimiter Error, falling back to in-memory]:", err);
    return inMemoryLimiter.checkAndRecord({
      clientIp: normIp,
      lotCode: code,
      now: currentTimestamp.getTime(),
    });
  }
}

/**
 * Lấy dữ liệu cache công khai cho mã lô (TTL 60s)
 * Đảm bảo: Nếu có lệnh thu hồi mới được tạo sau thời điểm cached_at,
 * bản cache phải bị vô hiệu hóa ngay lập tức (không đợi hết 60s).
 */
async function getPublicLotCache({
  pool,
  lotCode,
  inMemoryCache = defaultInMemoryCache,
  inMemoryRecallOrders = null,
  now = Date.now(),
}) {
  const code = String(lotCode || "").trim().toUpperCase();

  if (!pool) {
    const entry = inMemoryCache.get(code);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      inMemoryCache.delete(code);
      return null;
    }

    // Nếu bản cache hiện hành ghi nhận lô KHÔNG bị thu hồi,
    // nhưng trong inMemoryRecallOrders có lệnh thu hồi mới được tạo -> vô hiệu hóa ngay
    if (entry.payload?.lot?.recall?.isRecalled === false && Array.isArray(inMemoryRecallOrders)) {
      const hasRecentRecall = inMemoryRecallOrders.some((o) => {
        if (o.status !== "OPEN") return false;
        const orderCreated = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        return orderCreated >= (entry.cachedAt || 0);
      });
      if (hasRecentRecall) {
        inMemoryCache.delete(code);
        return null;
      }
    }

    return entry.payload;
  }

  try {
    const res = await pool.query(
      `SELECT payload, cached_at FROM public_lot_cache WHERE lot_code = $1 AND expires_at > NOW()`,
      [code]
    );
    if (res.rows.length === 0) {
      return null;
    }

    const cachedAt = new Date(res.rows[0].cached_at);
    const payload = res.rows[0].payload;

    // Kiểm tra nếu có bất kỳ lệnh thu hồi nào được mở từ sau thời điểm cached_at
    if (payload?.lot?.recall?.isRecalled === false) {
      const recallCheck = await pool.query(
        `SELECT 1 FROM recall_orders WHERE created_at >= $1 AND status = 'OPEN' LIMIT 1`,
        [cachedAt]
      );
      if (recallCheck.rows.length > 0) {
        // Vô hiệu hóa cache ngay lập tức
        await pool.query(`DELETE FROM public_lot_cache WHERE lot_code = $1`, [code]);
        inMemoryCache.delete(code);
        return null;
      }
    }

    return payload;
  } catch (err) {
    console.error("[getPublicLotCache Error]:", err);
    const entry = inMemoryCache.get(code);
    if (entry && entry.expiresAt > now) {
      return entry.payload;
    }
    return null;
  }
}

/**
 * Lưu dữ liệu cache công khai cho mã lô (TTL 60s)
 */
async function setPublicLotCache({
  pool,
  lotCode,
  payload,
  ttlSeconds = CACHE_TTL_SECONDS,
  inMemoryCache = defaultInMemoryCache,
  now = Date.now(),
}) {
  const code = String(lotCode || "").trim().toUpperCase();
  const expiresAtMs = now + ttlSeconds * 1000;

  // Cập nhật cả in-memory để phục vụ hit cực nhanh
  inMemoryCache.set(code, {
    payload,
    expiresAt: expiresAtMs,
    cachedAt: now,
  });

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO public_lot_cache (lot_code, payload, cached_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + ($3 || ' seconds')::INTERVAL)
         ON CONFLICT (lot_code) DO UPDATE
         SET payload = EXCLUDED.payload, cached_at = NOW(), expires_at = EXCLUDED.expires_at`,
        [code, JSON.stringify(payload), ttlSeconds]
      );
    } catch (err) {
      console.error("[setPublicLotCache Error]:", err);
    }
  }
}

/**
 * Vô hiệu hóa cache ngay lập tức khi lô bị thu hồi hoặc thay đổi trạng thái
 */
async function invalidatePublicLotCache({
  pool,
  lotCodes = [],
  lotIds = [],
  clearAll = false,
  inMemoryCache = defaultInMemoryCache,
}) {
  if (clearAll) {
    inMemoryCache.clear();
    if (pool) {
      try {
        await pool.query("DELETE FROM public_lot_cache");
      } catch (err) {
        console.error("[invalidatePublicLotCache clearAll Error]:", err);
      }
    }
    return;
  }

  const codesToInvalidate = new Set(
    (lotCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean)
  );

  // Nếu có danh sách lotIds, truy vấn mã tương ứng trên DB để xóa cache
  if (pool && Array.isArray(lotIds) && lotIds.length > 0) {
    try {
      const res = await pool.query(
        `SELECT code FROM lots WHERE id = ANY($1)`,
        [lotIds]
      );
      for (const r of res.rows) {
        if (r.code) codesToInvalidate.add(String(r.code).trim().toUpperCase());
      }
    } catch (err) {
      console.error("[invalidatePublicLotCache lotIds Error]:", err);
    }
  }

  for (const c of codesToInvalidate) {
    inMemoryCache.delete(c);
  }

  if (pool && codesToInvalidate.size > 0) {
    try {
      await pool.query(
        `DELETE FROM public_lot_cache WHERE lot_code = ANY($1)`,
        [Array.from(codesToInvalidate)]
      );
    } catch (err) {
      console.error("[invalidatePublicLotCache delete DB Error]:", err);
    }
  }
}

module.exports = {
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_MAX_DISTINCT_LOTS,
  RATE_LIMIT_BLOCK_DURATION_SECONDS,
  CACHE_TTL_SECONDS,
  normalizeIp,
  isTrustedProxy,
  getClientIp,
  InMemoryPublicRateLimiter,
  defaultInMemoryRateLimiter,
  defaultInMemoryCache,
  checkPublicLotRateLimit,
  getPublicLotCache,
  setPublicLotCache,
  invalidatePublicLotCache,
};
