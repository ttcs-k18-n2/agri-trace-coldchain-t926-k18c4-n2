const express = require("express");
const session = require("express-session");
const { hash, verify, Algorithm } = require("@node-rs/argon2");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { scopedQuery, scopedQueryById, SHARED_TABLES } = require("./query");
const { logSecurityEvent, getRecentSecurityLogs, clearSecurityLogs } = require("./security_logger");
const { generateLotCode } = require("./lot_code");
const { GENESIS_HASH, canonicalize, calculateEventHash, createEventHashPayload } = require("./integrity");
const {
  appendBatchEvent,
  getBatchEvents,
  verifyBatchEventChain,
  inMemoryBatchEvents,
  setAppendHookForTesting,
} = require("./event_repository");
const { verifyBatchIntegrity } = require("./integrity_verifier");
const { evaluateLotAccess } = require("./lot_access");
const { markOverdueTransfers, startTransferOverdueJob } = require("./transfer_overdue_job");
const {
  toMilliUnits,
  fromMilliUnits,
  formatQuantityString,
  validateSplitItems,
} = require("./quantity");
const app = express();
const PORT = Number(process.env.PORT || 3000);

const MAX_FAILED_ATTEMPTS = Number(process.env.MAX_FAILED_ATTEMPTS || 5);
const LOCK_MINUTES = Number(process.env.LOCK_MINUTES || 15);

let pool = (process.env.DATABASE_URL && process.env.NODE_ENV !== "test")
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

function setDatabasePool(customPool) {
  pool = customPool;
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const crypto = require("node:crypto");
const sessionSecret =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== "test") {
  console.warn(
    "[Security Warning] SESSION_SECRET is not set in environment; generated a secure random secret."
  );
}

app.set("trust proxy", 1);

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "test"
          ? false
          : process.env.COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "auto"
          ? "auto"
          : false,
      maxAge: 60 * 60 * 1000,
    },
  })
);

// Fallback in-memory store for unit test environments without postgres
const users = new Map();
const ORG_NAME_FALLBACKS = {
  "org-001": "Nông trại Thái Nguyên",
  "org-002": "Hợp tác xã Rau Sạch Bắc Giang",
  "org-003": "Nhà phân phối Chuỗi Lạnh",
  "org-inspector": "Cục Kiểm tra An toàn Nông sản",
  "org-system": "Cơ quan Quản lý Chuỗi Lạnh Toàn quốc",
  "org-trans": "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu",
  "org-dist": "Tổng Công ty Phân phối Nông sản & Bán lẻ",
};

const inMemoryOrgs = [
  { id: "org-001", name: "Nông trại Thái Nguyên", type: "producer" },
  { id: "org-002", name: "Hợp tác xã Rau Sạch Bắc Giang", type: "cooperative" },
  { id: "org-003", name: "Nhà phân phối Chuỗi Lạnh", type: "distributor" },
  { id: "org-inspector", name: "Cục Kiểm tra An toàn Nông sản", type: "inspector" },
  { id: "org-system", name: "Cơ quan Quản lý Chuỗi Lạnh Toàn quốc", type: "admin" },
  { id: "org-trans", name: "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu", type: "transporter" },
  { id: "org-dist", name: "Tổng Công ty Phân phối Nông sản & Bán lẻ", type: "distributor" },
];

const inMemoryProducts = [
  { id: "PROD-TOMATO", name: "Cà chua", unit: "kg" },
  { id: "PROD-TEA", name: "Chè", unit: "kg" },
  { id: "PROD-VEGETABLE", name: "Rau cải", unit: "kg" },
];
const inMemoryFarms = [
  { id: "FARM-001", name: "Thửa đồi chè La Bằng 01", area: 2.5, coordinates: "21.5645, 105.6789", organizationId: "org-001" },
  { id: "FARM-002", name: "Thửa cà chua Hùng Sơn 02", area: 1.2, coordinates: "21.5712, 105.6841", organizationId: "org-001" },
  { id: "FARM-101", name: "Thửa rau cải Yên Dũng 01", area: 3.0, coordinates: "21.2341, 106.1892", organizationId: "org-002" },
];
const inMemoryLots = [
  { id: "LOT-001", name: "Lô cà chua Thái Nguyên", status: "Đã thu hoạch", organizationId: "org-001", farmId: "FARM-002", productId: "PROD-TOMATO", initialQuantity: 500, remainingQuantity: 500, harvestedAt: "2026-09-25", parentLotId: null },
  { id: "LOT-002", name: "Lô chè Tân Cương", status: "Đã thu hoạch", organizationId: "org-001", farmId: "FARM-001", productId: "PROD-TEA", initialQuantity: 120, remainingQuantity: 120, harvestedAt: "2026-09-26", parentLotId: null },
  { id: "LOT-101", name: "Lô rau cải Bắc Giang", status: "Đã thu hoạch", organizationId: "org-002", farmId: "FARM-101", productId: "PROD-VEGETABLE", initialQuantity: 300, remainingQuantity: 300, harvestedAt: "2026-09-27", parentLotId: null },
  { id: "LOT-102", name: "Lô dưa chuột Hiệp Hòa", status: "Đã thu hoạch", organizationId: "org-002", farmId: null, productId: null, initialQuantity: 250, remainingQuantity: 250, harvestedAt: "2026-09-28", parentLotId: null },
];

const inMemoryIntegrityChecks = [];

const inMemoryOrganizations = [
  { id: "org-001", name: "Nông trại Thái Nguyên", type: "producer" },
  { id: "org-002", name: "Hợp tác xã Rau Sạch Bắc Giang", type: "cooperative" },
  { id: "org-trans", name: "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu", type: "transporter" },
  { id: "org-dist", name: "Tổng Công ty Phân phối Nông sản & Bán lẻ", type: "distributor" },
  { id: "org-inspector", name: "Cục Kiểm tra An toàn Nông sản", type: "inspector" },
  { id: "org-system", name: "Cơ quan Quản lý Chuỗi Lạnh Toàn quốc", type: "admin" },
];

const inMemoryTransfers = [];
const inMemoryBatchRelations = [];

async function getPendingTransferForLot(lotId) {
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT t.*, o_to.name AS to_organization_name, o_from.name AS from_organization_name
         FROM lot_transfers t
         LEFT JOIN organizations o_to ON t.to_organization_id = o_to.id
         LEFT JOIN organizations o_from ON t.from_organization_id = o_from.id
         WHERE t.lot_id = $1 AND t.status = 'PENDING'
         ORDER BY t.created_at DESC
         LIMIT 1`,
        [lotId]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        return {
          id: r.id,
          lotId: r.lot_id,
          fromOrganizationId: r.from_organization_id,
          fromOrganizationName: r.from_organization_name,
          toOrganizationId: r.to_organization_id,
          toOrganizationName: r.to_organization_name,
          status: r.status,
          notes: r.notes,
          isOverdue: Boolean(r.is_overdue),
          overdueAt: r.overdue_at || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      }
    } catch {
      // Bỏ qua lỗi query DB, fallback sang tra cứu in-memory
    }
  }
  const t = inMemoryTransfers.find((tr) => tr.lotId === lotId && tr.status === "PENDING");
  if (t) {
    const toOrg = inMemoryOrganizations.find((o) => o.id === t.toOrganizationId);
    const fromOrg = inMemoryOrganizations.find((o) => o.id === t.fromOrganizationId);
    return {
      ...t,
      isOverdue: Boolean(t.isOverdue || t.is_overdue),
      overdueAt: t.overdueAt || t.overdue_at || null,
      toOrganizationName: toOrg ? toOrg.name : t.toOrganizationId,
      fromOrganizationName: fromOrg ? fromOrg.name : t.fromOrganizationId,
    };
  }
  return null;
}

// Idempotency cache for S-09 AC4: Chống double-click & retry tạo trùng lô thu hoạch
const harvestIdempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 phút

function cleanupHarvestIdempotency() {
  const now = Date.now();
  for (const [key, item] of harvestIdempotencyCache.entries()) {
    if (now - item.createdAt > IDEMPOTENCY_TTL_MS) {
      harvestIdempotencyCache.delete(key);
    }
  }
}

function clearHarvestIdempotencyCache() {
  harvestIdempotencyCache.clear();
}


async function hashPassword(plainPassword) {
  return hash(plainPassword, { algorithm: Algorithm.Argon2id });
}

async function verifyPassword(hashVal, plainPassword) {
  try {
    return await verify(hashVal, plainPassword);
  } catch {
    return false;
  }
}

async function seedDemoUser() {
  const passwordHash = await hashPassword("Password@123");

  users.set("user@example.com", {
    id: "usr-001",
    email: "user@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "producer",
  });

  users.set("user2@example.com", {
    id: "usr-002",
    email: "user2@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-002",
    roleId: "cooperative",
  });

  users.set("inspector@example.com", {
    id: "usr-inspector",
    email: "inspector@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("admin@example.com", {
    id: "usr-admin",
    email: "admin@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  users.set("orgadmin@example.com", {
    id: "usr-orgadmin",
    email: "orgadmin@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "org_admin",
  });

  users.set("transporter@example.com", {
    id: "usr-transporter",
    email: "transporter@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-trans",
    roleId: "transporter",
  });

  users.set("distributor@example.com", {
    id: "usr-distributor",
    email: "distributor@example.com",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-dist",
    roleId: "distributor",
  });
}

function seedDemoEvents() {
  if (inMemoryBatchEvents.length === 0) {
    const ev1Data = {
      batchId: "LOT-001",
      sequenceNo: 1,
      eventType: "HARVEST_CREATED",
      payload: { farmId: "FARM-002", productId: "PROD-TOMATO", quantity: 500 },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: new Date("2026-09-25T08:00:00.000Z"),
    };
    const ev1Hash = calculateEventHash(GENESIS_HASH, ev1Data);
    inMemoryBatchEvents.push({
      id: "EVT-LOT-001-001",
      batchId: "LOT-001",
      batch_id: "LOT-001",
      sequenceNo: 1,
      sequence_no: 1,
      eventType: "HARVEST_CREATED",
      event_type: "HARVEST_CREATED",
      payload: ev1Data.payload,
      organizationId: "org-001",
      organization_id: "org-001",
      actorUserId: "usr-001",
      actor_user_id: "usr-001",
      occurredAt: "2026-09-25T08:00:00.000Z",
      occurred_at: "2026-09-25T08:00:00.000Z",
      previousHash: GENESIS_HASH,
      previous_hash: GENESIS_HASH,
      eventHash: ev1Hash,
      event_hash: ev1Hash,
      createdAt: "2026-09-25T08:00:00.000Z",
      created_at: "2026-09-25T08:00:00.000Z",
    });

    const ev2Data = {
      batchId: "LOT-002",
      sequenceNo: 1,
      eventType: "HARVEST_CREATED",
      payload: { farmId: "FARM-001", productId: "PROD-TEA", quantity: 120 },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: new Date("2026-09-26T08:00:00.000Z"),
    };
    const ev2Hash = calculateEventHash(GENESIS_HASH, ev2Data);
    inMemoryBatchEvents.push({
      id: "EVT-LOT-002-001",
      batchId: "LOT-002",
      batch_id: "LOT-002",
      sequenceNo: 1,
      sequence_no: 1,
      eventType: "HARVEST_CREATED",
      event_type: "HARVEST_CREATED",
      payload: ev2Data.payload,
      organizationId: "org-001",
      organization_id: "org-001",
      actorUserId: "usr-001",
      actor_user_id: "usr-001",
      occurredAt: "2026-09-26T08:00:00.000Z",
      occurred_at: "2026-09-26T08:00:00.000Z",
      previousHash: GENESIS_HASH,
      previous_hash: GENESIS_HASH,
      eventHash: ev2Hash,
      event_hash: ev2Hash,
      createdAt: "2026-09-26T08:00:00.000Z",
      created_at: "2026-09-26T08:00:00.000Z",
    });
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeReturnTo(value) {
  const returnTo = String(value || "/lots");
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return "/lots";
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    organizationId: user.organizationId || user.organization_id,
    roleId: user.roleId || user.role_id,
  };
}

function loginError(res) {
  return res.status(401).json({
    message: "Email hoặc mật khẩu không đúng.",
  });
}

async function getUserByEmail(email) {
  if (pool) {
    try {
      const res = await pool.query(
        "SELECT id, email, password_hash, organization_id, role_id, failed_count, locked_until FROM users WHERE email = $1",
        [email]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.id,
          email: row.email,
          passwordHash: row.password_hash,
          organizationId: row.organization_id,
          roleId: row.role_id,
          failedCount: Number(row.failed_count || 0),
          lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
        };
      }
    } catch (err) {
      console.warn("[DB getUserByEmail warning, fallback to memory]", err.message);
    }
  }

  return users.get(email) || null;
}

async function getUserById(id) {
  if (pool) {
    try {
      const res = await pool.query(
        "SELECT id, email, password_hash, organization_id, role_id, failed_count, locked_until FROM users WHERE id = $1",
        [id]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.id,
          email: row.email,
          passwordHash: row.password_hash,
          organizationId: row.organization_id,
          roleId: row.role_id,
          failedCount: Number(row.failed_count || 0),
          lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
        };
      }
    } catch (err) {
      console.warn("[DB getUserById warning, fallback to memory]", err.message);
    }
  }

  return [...users.values()].find((u) => u.id === id) || null;
}

async function updateUserLock(user, failedCount, lockedUntil) {
  user.failedCount = failedCount;
  user.lockedUntil = lockedUntil;

  if (pool) {
    try {
      const lockedDate = lockedUntil ? new Date(lockedUntil).toISOString() : null;
      await pool.query(
        "UPDATE users SET failed_count = $1, locked_until = $2, updated_at = NOW() WHERE id = $3",
        [failedCount, lockedDate, user.id]
      );
    } catch (err) {
      console.warn("[DB updateUserLock warning]", err.message);
    }
  }
}

async function resetUserLock(user) {
  user.failedCount = 0;
  user.lockedUntil = null;

  if (pool) {
    try {
      await pool.query(
        "UPDATE users SET failed_count = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1",
        [user.id]
      );
    } catch (err) {
      console.warn("[DB resetUserLock warning]", err.message);
    }
  }
}

/**
 * Middleware gắn ngữ cảnh xác thực và tổ chức vào yêu cầu (T-11)
 */
function attachAuthContext(req, _res, next) {
  if (req.session && req.session.userId) {
    req.auth = {
      id: req.session.userId,
      userId: req.session.userId,
      email: req.session.email,
      organizationId: req.session.organizationId,
      roleId: req.session.roleId,
      isInspector: req.session.roleId === "inspector",
    };
  } else {
    req.auth = null;
  }
  next();
}

app.use(attachAuthContext);

/**
 * Middleware phân quyền và mặc định từ chối route chưa khai báo quyền (T-11)
 * @param {string[]} allowedRoles - Danh sách vai trò được phép truy cập
 */
function requirePermission(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
      if (req.accepts("html") && !req.accepts("json")) {
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(302, `/login?returnTo=${returnTo}`);
      }
      return res.status(401).json({ message: "Chưa đăng nhập." });
    }

    // Mặc định từ chối route chưa khai quyền
    if (!allowedRoles || allowedRoles.length === 0) {
      return res.status(403).json({
        message: "Truy cập bị từ chối: route chưa khai báo quyền rõ ràng.",
      });
    }

    const { roleId, isInspector } = req.auth;

    // Cán bộ kiểm tra chỉ được đọc (GET / HEAD), không được ghi (POST, PUT, DELETE, PATCH)
    if (isInspector && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return res.status(403).json({
        message: "Cán bộ kiểm tra chỉ có quyền đọc dữ liệu, không được phép thực hiện thao tác ghi.",
      });
    }

    // Cán bộ kiểm tra được đọc mọi tổ chức ở các route đọc
    if (isInspector && ["GET", "HEAD"].includes(req.method)) {
      return next();
    }

    // Admin hệ thống có toàn quyền
    if (roleId === "admin") {
      return next();
    }

    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        message: "Bạn không có quyền thực hiện thao tác này.",
      });
    }

    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/login?returnTo=${returnTo}`);
  }
  next();
}

async function checkHealth(_req, res) {
  if (!pool) {
    return res.json({
      service: "agri-trace-backend",
      status: "ok",
      database: "not_configured",
      commit: process.env.GIT_COMMIT || "unknown",
    });
  }

  try {
    const result = await pool.query("SELECT NOW() AS now, CURRENT_USER AS db_user");
    return res.json({
      service: "agri-trace-backend",
      status: "ok",
      database: "connected",
      databaseUser: result.rows[0].db_user,
      timestamp: result.rows[0].now,
      commit: process.env.GIT_COMMIT || "unknown",
    });
  } catch {
    return res.status(503).json({
      service: "agri-trace-backend",
      status: "error",
      database: "disconnected",
      message: "Database connection unavailable",
    });
  }
}

app.get("/", (req, res) => {
  if (req.accepts("html") && !req.accepts("json")) {
    return res.redirect("/login");
  }
  return res.json({
    service: "agri-trace-backend",
    status: "ok",
  });
});

app.get("/health", checkHealth);
app.get("/api/health", checkHealth);

app.post("/api/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const returnTo = safeReturnTo(req.body.returnTo);

  const user = await getUserByEmail(email);

  if (!user) {
    return loginError(res);
  }

  const now = Date.now();

  // Kiểm tra khóa trước khi kiểm tra mật khẩu
  if (user.lockedUntil && user.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((user.lockedUntil - now) / 1000);
    return res.status(423).json({
      message: "Tài khoản đang bị khóa tạm thời.",
      retryAfterSeconds,
    });
  }

  // Hết thời gian khóa -> reset tự động
  if (user.lockedUntil && user.lockedUntil <= now) {
    await resetUserLock(user);
  }

  const validPassword = await verifyPassword(user.passwordHash, password);

  if (!validPassword) {
    const nextFailedCount = (user.failedCount || 0) + 1;
    const lockUntil =
      nextFailedCount >= MAX_FAILED_ATTEMPTS
        ? now + LOCK_MINUTES * 60 * 1000
        : null;

    await updateUserLock(user, nextFailedCount, lockUntil);
    return loginError(res);
  }

  // Đăng nhập thành công
  await resetUserLock(user);

  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.organizationId = user.organizationId;
  req.session.roleId = user.roleId;

  return res.status(200).json({
    message: "Đăng nhập thành công.",
    user: publicUser(user),
    redirectTo: returnTo,
  });
});

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      message: "Chưa đăng nhập.",
    });
  }

  const user = await getUserById(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({
      message: "Phiên không hợp lệ.",
    });
  }

  return res.status(200).json({
    user: publicUser(user),
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        message: "Không thể đăng xuất.",
      });
    }

    res.clearCookie("connect.sid");

    return res.status(200).json({
      message: "Đăng xuất thành công.",
    });
  });
});

// Route chưa khai quyền rõ ràng -> mặc định từ chối (T-11)
app.get("/api/unmapped-protected", requirePermission([]), (_req, res) => {
  return res.json({ ok: true });
});

/**
 * Danh mục sản phẩm (T-16, S-07)
 * Mọi vai trò đăng nhập đều có quyền xem danh mục dùng chung
 */
app.get(
  "/api/products",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    if (pool) {
      try {
        const result = await pool.query("SELECT id, name, unit, created_at FROM products ORDER BY name ASC");
        return res.status(200).json({ products: result.rows });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    return res.status(200).json({
      products: inMemoryProducts.slice().sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
);

/**
 * Chi tiết một sản phẩm theo ID kèm số lượng lô hàng (S-07)
 */
app.get(
  "/api/products/:id",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const { id } = req.params;
    if (pool) {
      try {
        const result = await pool.query(
          "SELECT id, name, unit, created_at FROM products WHERE id = $1",
          [id]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Không tìm thấy sản phẩm." });
        }
        const lotsCountRes = await pool.query(
          "SELECT COUNT(*)::int as count FROM lots WHERE product_id = $1",
          [id]
        );
        const lotsCount = lotsCountRes.rows[0] ? lotsCountRes.rows[0].count : 0;
        return res.status(200).json({
          product: result.rows[0],
          lotsCount,
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    const prod = inMemoryProducts.find((p) => p.id === id);
    if (!prod) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm." });
    }
    const lotsCount = inMemoryLots.filter((l) => (l.productId || l.product_id) === id).length;
    return res.status(200).json({
      product: prod,
      lotsCount,
    });
  }
);

/**
 * Thêm sản phẩm mới (T-16, S-07)
 * Chỉ admin hệ thống mới có quyền thêm sản phẩm
 */
app.post(
  "/api/products",
  requirePermission(["admin"]),
  async (req, res) => {
    const { name, unit } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Tên sản phẩm không được để trống." });
    }

    const cleanName = name.trim();
    const validUnits = ["kg", "tan", "thung"];
    if (!unit || !validUnits.includes(unit)) {
      return res.status(400).json({ message: "Đơn vị không hợp lệ. Chỉ chấp nhận: kg, tan, thung." });
    }

    const prodId = req.body.id || `PROD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    if (pool) {
      try {
        const dupCheck = await pool.query(
          "SELECT id FROM products WHERE LOWER(name) = LOWER($1)",
          [cleanName]
        );
        if (dupCheck.rows.length > 0) {
          return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
        }

        const insertRes = await pool.query(
          "INSERT INTO products (id, name, unit) VALUES ($1, $2, $3) RETURNING id, name, unit, created_at",
          [prodId, cleanName, unit]
        );
        return res.status(201).json({
          message: "Thêm sản phẩm thành công.",
          product: insertRes.rows[0],
        });
      } catch (err) {
        if (err.code === "23505") {
          return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
        }
        return res.status(500).json({ message: err.message });
      }
    }

    // In-memory fallback
    const dup = inMemoryProducts.find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    if (dup) {
      return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
    }

    const newProd = { id: prodId, name: cleanName, unit, created_at: new Date().toISOString() };
    inMemoryProducts.push(newProd);

    return res.status(201).json({
      message: "Thêm sản phẩm thành công.",
      product: newProd,
    });
  }
);

/**
 * Chỉnh sửa sản phẩm (T-17, S-07)
 * Chỉ tài khoản Admin mới có quyền cập nhật tên hoặc đơn vị tính.
 */
app.put(
  "/api/products/:id",
  requirePermission(["admin"]),
  async (req, res) => {
    const { id } = req.params;
    const { name, unit } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Tên sản phẩm không được để trống." });
    }

    const cleanName = name.trim();
    const validUnits = ["kg", "tan", "thung"];
    if (!unit || !validUnits.includes(unit)) {
      return res.status(400).json({ message: "Đơn vị không hợp lệ. Chỉ chấp nhận: kg, tan, thung." });
    }

    if (pool) {
      try {
        const checkExist = await scopedQueryById(pool, req.auth, "products", id);
        if (!checkExist.row) {
          return res.status(404).json({ message: "Không tìm thấy sản phẩm." });
        }

        const dupCheck = await pool.query(
          "SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND id != $2",
          [cleanName, id]
        );
        if (dupCheck.rows.length > 0) {
          return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
        }

        const updateRes = await pool.query(
          "UPDATE products SET name = $1, unit = $2 WHERE id = $3 RETURNING id, name, unit, created_at",
          [cleanName, unit, id]
        );

        return res.status(200).json({
          message: "Cập nhật sản phẩm thành công.",
          product: updateRes.rows[0],
        });
      } catch (err) {
        if (err.code === "23505") {
          return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
        }
        return res.status(500).json({ message: err.message });
      }
    }

    // In-memory fallback
    const prod = inMemoryProducts.find((p) => p.id === id);
    if (!prod) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm." });
    }

    const dup = inMemoryProducts.find(
      (p) => p.id !== id && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (dup) {
      return res.status(409).json({ message: "Sản phẩm với tên này đã tồn tại." });
    }

    prod.name = cleanName;
    prod.unit = unit;

    return res.status(200).json({
      message: "Cập nhật sản phẩm thành công.",
      product: prod,
    });
  }
);

/**
 * Danh sách lô hàng của tổ chức hiện tại (T-12, T-13, T-20, S-14 / T-33)
 * Hỗ trợ server-side search mã lô, lọc theo sản phẩm, sắp xếp mới nhất (newest first),
 * và phân trang dạng con trỏ (cursor-based pagination).
 */
app.get(
  ["/api/lots", "/api/organization/lots"],
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const isInspector = req.auth.isInspector;
    const orgId = req.auth.organizationId;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const productId = typeof req.query.productId === "string" ? req.query.productId.trim() : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const cursor = req.query.cursor ? String(req.query.cursor).trim() : null;

    let cursorData = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
        cursorData = JSON.parse(decoded);
      } catch {
        cursorData = null;
      }
    }

    if (pool) {
      try {
        let sql = `
          SELECT
            l.id, l.name, l.status, l.organization_id, l.created_at,
            l.farm_id, f.name AS farm_name,
            l.product_id, p.name AS product_name, p.unit AS product_unit,
            l.initial_quantity, l.remaining_quantity, l.harvested_at,
            lt.id AS pending_transfer_id, lt.to_organization_id AS pending_to_org_id,
            o_to.name AS pending_to_org_name, lt.created_at AS pending_created_at,
            lt.is_overdue AS pending_is_overdue, lt.overdue_at AS pending_overdue_at
          FROM lots l
          LEFT JOIN farms f ON l.farm_id = f.id
          LEFT JOIN products p ON l.product_id = p.id
          LEFT JOIN lot_transfers lt ON l.id = lt.lot_id AND lt.status = 'PENDING'
          LEFT JOIN organizations o_to ON lt.to_organization_id = o_to.id
        `;
        const conditions = [];
        const params = [];

        // 1. Phân quyền tổ chức (T-12, T-13, S-14)
        if (!isInspector && req.auth.roleId !== "admin") {
          params.push(orgId);
          conditions.push(`l.organization_id = $${params.length}`);
        }

        // 2. Tìm kiếm mã lô không phân biệt hoa/thường (S-14)
        if (search) {
          params.push(`%${search}%`);
          conditions.push(`l.id ILIKE $${params.length}`);
        }

        // 3. Lọc theo sản phẩm (S-14)
        if (productId) {
          params.push(productId);
          conditions.push(`l.product_id = $${params.length}`);
        }

        // 4. Cursor pagination (T-33): (harvested_at, created_at, id) < (cursorHarvest, cursorCreated, cursorId)
        if (cursorData && cursorData.harvestedAt && cursorData.id) {
          params.push(cursorData.harvestedAt);
          const p1 = params.length;
          params.push(cursorData.createdAt || cursorData.harvestedAt);
          const p2 = params.length;
          params.push(cursorData.id);
          const p3 = params.length;

          conditions.push(`(
            l.harvested_at < $${p1}
            OR (l.harvested_at = $${p1} AND l.created_at < $${p2})
            OR (l.harvested_at = $${p1} AND l.created_at = $${p2} AND l.id < $${p3})
          )`);
        }

        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }

        // Sắp xếp mới nhất trước (newest first)
        sql += ` ORDER BY l.harvested_at DESC, l.created_at DESC, l.id DESC`;

        // Lấy limit + 1 để xác định hasMore mà không cần COUNT(*)
        params.push(limit + 1);
        sql += ` LIMIT $${params.length}`;

        const queryRes = await pool.query(sql, params);
        const hasMore = queryRes.rows.length > limit;
        const rows = hasMore ? queryRes.rows.slice(0, limit) : queryRes.rows;

        let nextCursor = null;
        if (hasMore && rows.length > 0) {
          const last = rows[rows.length - 1];
          nextCursor = Buffer.from(
            JSON.stringify({
              harvestedAt: last.harvested_at,
              createdAt: last.created_at,
              id: last.id,
            })
          ).toString("base64url");
        }

        return res.status(200).json({
          organizationId: orgId,
          lots: rows.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            organizationId: r.organization_id,
            farmId: r.farm_id,
            farmName: r.farm_name,
            productId: r.product_id,
            productName: r.product_name,
            productUnit: r.product_unit,
            initialQuantity: r.initial_quantity !== null && r.initial_quantity !== undefined ? Number(r.initial_quantity) : null,
            remainingQuantity: r.remaining_quantity !== null && r.remaining_quantity !== undefined ? Number(r.remaining_quantity) : null,
            harvestedAt: r.harvested_at,
            createdAt: r.created_at,
            pendingTransfer: r.pending_transfer_id ? {
              id: r.pending_transfer_id,
              toOrganizationId: r.pending_to_org_id,
              toOrganizationName: r.pending_to_org_name || r.pending_to_org_id,
              status: "PENDING",
              isOverdue: Boolean(r.pending_is_overdue),
              overdueAt: r.pending_overdue_at || null,
              createdAt: r.pending_created_at,
            } : null,
          })),
          nextCursor,
          hasMore,
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    // In-memory fallback
    let filtered = isInspector || req.auth.roleId === "admin"
      ? [...inMemoryLots]
      : inMemoryLots.filter((lot) => lot.organizationId === orgId);

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((l) => l.id && l.id.toLowerCase().includes(searchLower));
    }

    if (productId) {
      filtered = filtered.filter((l) => l.productId === productId);
    }

    // Sort newest first: harvestedAt DESC, createdAt DESC, id DESC
    filtered.sort((a, b) => {
      const hA = new Date(a.harvestedAt || 0).getTime();
      const hB = new Date(b.harvestedAt || 0).getTime();
      if (hB !== hA) return hB - hA;

      const cA = new Date(a.createdAt || 0).getTime();
      const cB = new Date(b.createdAt || 0).getTime();
      if (cB !== cA) return cB - cA;

      return (b.id || "").localeCompare(a.id || "");
    });

    if (cursorData && cursorData.id) {
      const curHA = new Date(cursorData.harvestedAt || 0).getTime();
      const curCA = new Date(cursorData.createdAt || 0).getTime();
      const curId = cursorData.id;

      filtered = filtered.filter((l) => {
        const lHA = new Date(l.harvestedAt || 0).getTime();
        const lCA = new Date(l.createdAt || 0).getTime();
        if (lHA < curHA) return true;
        if (lHA > curHA) return false;
        if (lCA < curCA) return true;
        if (lCA > curCA) return false;
        return (l.id || "") < curId;
      });
    }

    const hasMore = filtered.length > limit;
    const sliced = hasMore ? filtered.slice(0, limit) : filtered;

    let nextCursor = null;
    if (hasMore && sliced.length > 0) {
      const last = sliced[sliced.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          harvestedAt: last.harvestedAt,
          createdAt: last.createdAt || last.harvestedAt,
          id: last.id,
        })
      ).toString("base64url");
    }

    return res.status(200).json({
      organizationId: orgId,
      lots: sliced.map((l) => {
        const farm = inMemoryFarms.find((f) => f.id === l.farmId);
        const product = inMemoryProducts.find((p) => p.id === l.productId);
        const pending = inMemoryTransfers.find((t) => t.lotId === l.id && t.status === "PENDING");
        const toOrg = pending ? inMemoryOrganizations.find((o) => o.id === pending.toOrganizationId) : null;
        return {
          id: l.id,
          name: l.name,
          status: l.status,
          organizationId: l.organizationId,
          farmId: l.farmId,
          farmName: farm ? farm.name : null,
          productId: l.productId,
          productName: product ? product.name : null,
          productUnit: product ? product.unit : "kg",
          initialQuantity: l.initialQuantity !== undefined ? l.initialQuantity : 100,
          remainingQuantity: l.remainingQuantity !== undefined ? l.remainingQuantity : (l.remaining_quantity !== undefined ? l.remaining_quantity : 100),
          harvestedAt: l.harvestedAt || "2026-09-30",
          createdAt: l.createdAt || "2026-09-30T00:00:00.000Z",
          pendingTransfer: pending ? {
            id: pending.id,
            toOrganizationId: pending.toOrganizationId,
            toOrganizationName: toOrg ? toOrg.name : pending.toOrganizationId,
            status: "PENDING",
            isOverdue: Boolean(pending.isOverdue || pending.is_overdue),
            overdueAt: pending.overdueAt || pending.overdue_at || null,
            createdAt: pending.createdAt,
          } : null,
        };
      }),
      nextCursor,
      hasMore,
    });
  }
);

/**
 * Xem chi tiết lô hàng - kèm quan hệ lô mẹ/con trực tiếp và chặn truy cập chéo tổ chức (T-13, NFR)
 */
app.get(
  ["/api/lots/:id", "/api/organization/lots/:id"],
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const lotId = req.params.id;
    const callerOrgId = req.auth ? req.auth.organizationId || req.auth.organization_id : null;
    const isGlobal = Boolean(
      req.auth &&
        (req.auth.roleId === "inspector" ||
          req.auth.isInspector ||
          req.auth.roleId === "admin" ||
          req.auth.isAdmin)
    );
    try {
      let lot = null;
      if (pool) {
        // Lệnh 1: Lấy thông tin lô hàng kèm JOIN sản phẩm, thửa đất, tổ chức và lô mẹ trực tiếp (NFR: 1 query)
        const lotQuery = `
          SELECT 
            l.id, l.name, l.status, l.organization_id, l.farm_id, l.product_id,
            l.initial_quantity, l.remaining_quantity, l.harvested_at, l.created_at, l.parent_lot_id,
            f.name AS farm_name,
            p.name AS product_name, p.unit AS product_unit,
            o.name AS organization_name,
            pl.id AS parent_id, pl.name AS parent_name, pl.status AS parent_status,
            pl.product_id AS parent_product_id, pl.organization_id AS parent_organization_id,
            pl.initial_quantity AS parent_initial_quantity, pl.remaining_quantity AS parent_remaining_quantity,
            pp.name AS parent_product_name, pp.unit AS parent_product_unit,
            po.name AS parent_organization_name
          FROM lots l
          LEFT JOIN farms f ON l.farm_id = f.id
          LEFT JOIN products p ON l.product_id = p.id
          LEFT JOIN organizations o ON l.organization_id = o.id
          LEFT JOIN lots pl ON l.parent_lot_id = pl.id
          LEFT JOIN products pp ON pl.product_id = pp.id
          LEFT JOIN organizations po ON pl.organization_id = po.id
          WHERE l.id = $1
        `;
        const lotRes = await pool.query(lotQuery, [lotId]);
        const row = lotRes.rows[0];
        if (!row) {
          return res.status(404).json({ message: "Không tìm thấy lô hàng." });
        }

        let accessType = "CURRENT_HOLDER";
        let ancestors = [];

        // Nếu người gọi không phải inspector/admin và không phải tổ chức đang nắm giữ trực tiếp -> kiểm tra phả hệ/lịch sử
        // NFR T-58: Gom toàn bộ kiểm tra quyền phả hệ / lịch sử bàn giao vào đúng 1 truy vấn SQL duy nhất (<= 3 queries tổng)
        if (!isGlobal && row.organization_id !== callerOrgId) {
          if (!callerOrgId) {
            return res.status(403).json({
              message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
            });
          }

          const accessCheckSql = `
            WITH RECURSIVE descendants AS (
              SELECT id FROM lots WHERE id = $1
              UNION
              SELECT l.id FROM lots l
              JOIN descendants d ON l.parent_lot_id = d.id
              UNION
              SELECT br.child_batch_id FROM batch_relations br
              JOIN descendants d ON br.parent_batch_id = d.id
            )
            SELECT 'ANCESTOR_OF_HELD_LOT' AS access_type
            FROM descendants d
            JOIN lots l ON d.id = l.id
            WHERE l.organization_id = $2 AND l.id <> $1
            UNION ALL
            SELECT 'PAST_HOLDER' AS access_type
            FROM lot_transfers
            WHERE lot_id = $1 AND (from_organization_id = $2 OR to_organization_id = $2)
            LIMIT 1;
          `;
          const accessRes = await pool.query(accessCheckSql, [lotId, callerOrgId]);

          if (accessRes.rows.length === 0) {
            logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
              userId: req.auth.userId || req.auth.id,
              userEmail: req.auth.email,
              userOrgId: req.auth.organizationId,
              userRole: req.auth.roleId,
              resourceType: "lots",
              resourceId: lotId,
              targetOrgId: row.organization_id,
              action: "READ",
              ip: req.ip,
              userAgent: req.get("User-Agent"),
            });
            return res.status(403).json({
              message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
            });
          }

          accessType = accessRes.rows[0].access_type;
          ancestors = [];
        }

        // Lệnh 2: Lấy danh sách các lô con trực tiếp (NFR: 1 query)
        const childQuery = `
          SELECT 
            c.id, c.name, c.status, c.organization_id, c.product_id, c.farm_id,
            c.initial_quantity, c.remaining_quantity, c.harvested_at, c.created_at, c.parent_lot_id,
            p.name AS product_name, p.unit AS product_unit,
            o.name AS organization_name
          FROM lots c
          LEFT JOIN products p ON c.product_id = p.id
          LEFT JOIN organizations o ON c.organization_id = o.id
          WHERE c.parent_lot_id = $1
          ORDER BY c.created_at DESC, c.id DESC
        `;
        const childRes = await pool.query(childQuery, [lotId]);

        let parentLot = null;
        if (row.parent_id) {
          parentLot = {
            id: row.parent_id,
            name: row.parent_name,
            status: row.parent_status,
            productId: row.parent_product_id,
            productName: row.parent_product_name,
            productUnit: row.parent_product_unit || "kg",
            organizationId: row.parent_organization_id,
            organizationName: row.parent_organization_name,
            initialQuantity: row.parent_initial_quantity !== null && row.parent_initial_quantity !== undefined ? Number(row.parent_initial_quantity) : null,
            remainingQuantity: row.parent_remaining_quantity !== null && row.parent_remaining_quantity !== undefined ? Number(row.parent_remaining_quantity) : null,
          };
        }

        const childLots = childRes.rows.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          organizationId: c.organization_id,
          organizationName: c.organization_name,
          productId: c.product_id,
          productName: c.product_name,
          productUnit: c.product_unit || "kg",
          initialQuantity: c.initial_quantity !== null && c.initial_quantity !== undefined ? Number(c.initial_quantity) : null,
          remainingQuantity: c.remaining_quantity !== null && c.remaining_quantity !== undefined ? Number(c.remaining_quantity) : null,
          harvestedAt: c.harvested_at,
          createdAt: c.created_at,
          parentLotId: c.parent_lot_id,
        }));

        lot = {
          id: row.id,
          name: row.name,
          status: row.status,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          farmId: row.farm_id,
          farmName: row.farm_name,
          productId: row.product_id,
          productName: row.product_name,
          productUnit: row.product_unit || "kg",
          initialQuantity: row.initial_quantity !== null && row.initial_quantity !== undefined ? Number(row.initial_quantity) : null,
          remainingQuantity: row.remaining_quantity !== null && row.remaining_quantity !== undefined ? Number(row.remaining_quantity) : null,
          harvestedAt: row.harvested_at,
          createdAt: row.created_at,
          parentLotId: row.parent_lot_id || null,
          parentLot,
          childLots,
          accessType,
          ancestors,
        };
      } else {
        const access = await evaluateLotAccess({
          pool,
          authContext: req.auth,
          lotId,
          inMemoryLots,
          inMemoryOrgs,
          skipEvents: true,
        });

        if (access.status === "NOT_FOUND") {
          return res.status(404).json({ message: "Không tìm thấy lô hàng." });
        }

        if (!access.allowed) {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "lots",
            resourceId: lotId,
            targetOrgId: access.targetOrgId,
            action: "READ",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
          });
        }

        const rawLot = access.lot;
        const farmId = rawLot.farmId || rawLot.farm_id || null;
        const productId = rawLot.productId || rawLot.product_id || null;
        const parentLotId = rawLot.parentLotId || rawLot.parent_lot_id || null;

        const farm = inMemoryFarms.find((f) => f.id === farmId);
        const product = inMemoryProducts.find((p) => p.id === productId);
        const farmName = rawLot.farmName || (farm ? farm.name : null);
        const productName = rawLot.productName || (product ? product.name : null);
        const productUnit = rawLot.productUnit || (product ? product.unit : "kg");

        const getOrgName = (orgId) => {
          if (!orgId) return null;
          const org = inMemoryOrgs.find((o) => o.id === orgId);
          return org ? org.name : (ORG_NAME_FALLBACKS[orgId] || orgId);
        };

        let parentLot = null;
        if (parentLotId) {
          const pLot = inMemoryLots.find((l) => l.id === parentLotId);
          if (pLot) {
            const pProd = inMemoryProducts.find((p) => p.id === (pLot.productId || pLot.product_id));
            const pInitQty = pLot.initialQuantity !== undefined ? pLot.initialQuantity : pLot.initial_quantity;
            const pRemQty = pLot.remainingQuantity !== undefined ? pLot.remainingQuantity : pLot.remaining_quantity;
            parentLot = {
              id: pLot.id,
              name: pLot.name,
              status: pLot.status,
              productId: pLot.productId || pLot.product_id || null,
              productName: pProd ? pProd.name : (pLot.productName || null),
              productUnit: pProd ? pProd.unit : (pLot.productUnit || "kg"),
              organizationId: pLot.organizationId || pLot.organization_id || null,
              organizationName: getOrgName(pLot.organizationId || pLot.organization_id),
              initialQuantity: pInitQty !== null && pInitQty !== undefined ? Number(pInitQty) : null,
              remainingQuantity: pRemQty !== null && pRemQty !== undefined ? Number(pRemQty) : null,
            };
          } else {
            parentLot = { id: parentLotId, name: parentLotId };
          }
        }

        const childLots = inMemoryLots
          .filter((l) => (l.parentLotId || l.parent_lot_id) === lotId)
          .map((cL) => {
            const cProd = inMemoryProducts.find((p) => p.id === (cL.productId || cL.product_id));
            const cInitQty = cL.initialQuantity !== undefined ? cL.initialQuantity : cL.initial_quantity;
            const cRemQty = cL.remainingQuantity !== undefined ? cL.remainingQuantity : cL.remaining_quantity;
            return {
              id: cL.id,
              name: cL.name,
              status: cL.status,
              organizationId: cL.organizationId || cL.organization_id,
              organizationName: getOrgName(cL.organizationId || cL.organization_id),
              productId: cL.productId || cL.product_id || null,
              productName: cProd ? cProd.name : (cL.productName || null),
              productUnit: cProd ? cProd.unit : (cL.productUnit || "kg"),
              initialQuantity: cInitQty !== null && cInitQty !== undefined ? Number(cInitQty) : null,
              remainingQuantity: cRemQty !== null && cRemQty !== undefined ? Number(cRemQty) : null,
              harvestedAt: cL.harvestedAt || cL.harvested_at || null,
              createdAt: cL.createdAt || cL.created_at || null,
              parentLotId: lotId,
            };
          });

        const initQty = rawLot.initialQuantity !== undefined ? rawLot.initialQuantity : rawLot.initial_quantity;
        const remQty = rawLot.remainingQuantity !== undefined ? rawLot.remainingQuantity : rawLot.remaining_quantity;

        lot = {
          id: rawLot.id,
          name: rawLot.name,
          status: rawLot.status,
          organizationId: rawLot.organizationId || rawLot.organization_id,
          organizationName: rawLot.organizationName || getOrgName(rawLot.organizationId || rawLot.organization_id),
          farmId,
          farmName,
          productId,
          productName,
          productUnit,
          initialQuantity: initQty !== null && initQty !== undefined ? Number(initQty) : null,
          remainingQuantity: remQty !== null && remQty !== undefined ? Number(remQty) : null,
          harvestedAt: rawLot.harvestedAt || rawLot.harvested_at || null,
          createdAt: rawLot.createdAt || rawLot.created_at || null,
          parentLotId,
          parentLot,
          childLots,
          accessType: access.accessType,
          ancestors: access.ancestors,
        };
      }

      const isCurrentHolder = Boolean(callerOrgId && lot && (lot.organizationId === callerOrgId || lot.organization_id === callerOrgId));
      if (isGlobal || isCurrentHolder || !pool) {
        const pendingTransfer = await getPendingTransferForLot(lot.id);
        lot.pendingTransfer = pendingTransfer;
      } else {
        lot.pendingTransfer = null;
      }

      return res.status(200).json({ lot });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * API Tách Lô hàng [S-17 / S-18]
 * - Kiểm tra quyền bên nắm giữ (producer, cooperative, org_admin, admin)
 * - Kiểm tra khối lượng: Tổng khối lượng các lô con <= Khối lượng còn lại của lô mẹ
 * - Transaction & FOR UPDATE chống xung đột tách đồng thời
 * - Tự động sinh mã lô con (generateLotCode), trừ khối lượng lô mẹ, gán parent_lot_id
 * - Ghi sự kiện cryptographic hash ledger: LOT_SPLIT cho lô mẹ và CREATED_FROM_SPLIT cho từng lô con
 */
app.post(
  "/api/lots/:id/split",
  requirePermission(["producer", "cooperative", "org_admin", "admin"]),
  async (req, res) => {
    const parentLotId = req.params.id;
    const { splits, subLots } = req.body || {};
    const splitItems = Array.isArray(splits) ? splits : (Array.isArray(subLots) ? subLots : []);

    if (splitItems.length === 0) {
      return res.status(400).json({
        error: "INVALID_SPLITS",
        message: "Danh sách lô con cần tách (splits) không được để trống.",
      });
    }

    // Kiểm tra từng lô con và tính tổng khối lượng chuẩn xác (S-18 / T-42)
    const splitValidation = validateSplitItems(splitItems);
    if (!splitValidation.valid) {
      return res.status(400).json({
        error: splitValidation.error,
        message: splitValidation.message,
      });
    }

    const totalSplitQuantity = splitValidation.totalQuantity;
    const totalSplitMilli = splitValidation.totalMilli;
    const userOrgId = req.auth ? (req.auth.organizationId || req.auth.organization_id) : null;
    const userId = req.auth ? (req.auth.userId || req.auth.id) : null;
    const isAdmin = req.auth && (req.auth.roleId === "admin" || req.auth.isAdmin);

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Khóa FOR UPDATE để chống xung đột tách đồng thời (S-17 / S-18)
        const parentRes = await client.query(
          "SELECT * FROM lots WHERE id = $1 FOR UPDATE",
          [parentLotId]
        );

        if (parentRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            error: "LOT_NOT_FOUND",
            message: "Không tìm thấy lô hàng mẹ cần tách.",
          });
        }

        const parentLot = parentRes.rows[0];

        // Kiểm tra quyền nắm giữ: chỉ tổ chức đang nắm giữ (hoặc admin) mới có quyền tách
        if (!isAdmin && parentLot.organization_id !== userOrgId) {
          await client.query("ROLLBACK");
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId,
            userEmail: req.auth.email,
            userOrgId,
            userRole: req.auth.roleId,
            resourceType: "lots",
            resourceId: parentLotId,
            targetOrgId: parentLot.organization_id,
            action: "SPLIT",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            error: "FORBIDDEN",
            message: "Truy cập bị từ chối: bạn không có quyền tách lô hàng của tổ chức khác.",
          });
        }

        // Kiểm tra nếu lô đang chờ xác nhận bàn giao
        const pendingCheck = await client.query(
          "SELECT id FROM lot_transfers WHERE lot_id = $1 AND status = 'PENDING'",
          [parentLotId]
        );
        if (pendingCheck.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "PENDING_TRANSFER_EXISTS",
            message: "Không thể tách lô hàng đang trong trạng thái chờ xác nhận bàn giao.",
          });
        }

        const parentRemaining = Number(parentLot.remaining_quantity);
        const parentRemainingMilli = toMilliUnits(parentRemaining, true);
        if (totalSplitMilli > parentRemainingMilli) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "EXCEEDS_REMAINING_QUANTITY",
            message: `Tổng khối lượng tách (${totalSplitQuantity.toFixed(3)}) vượt quá khối lượng còn lại của lô mẹ (${parentRemaining.toFixed(3)}).`,
          });
        }

        // 1. Trừ khối lượng còn lại của lô mẹ bằng phép tính NUMERIC trong PostgreSQL (T-42)
        // kèm điều kiện remaining_quantity >= $1::numeric để phòng vệ bổ sung
        const updateParentRes = await client.query(
          `UPDATE lots
           SET remaining_quantity = (remaining_quantity - $1::numeric)
           WHERE id = $2 AND remaining_quantity >= $1::numeric
           RETURNING *`,
          [formatQuantityString(totalSplitQuantity), parentLotId]
        );

        if (updateParentRes.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "EXCEEDS_REMAINING_QUANTITY",
            message: `Tổng khối lượng tách (${totalSplitQuantity.toFixed(3)}) vượt quá khối lượng còn lại của lô mẹ.`,
          });
        }

        const updatedParent = updateParentRes.rows[0];
        const newRemaining = Number(updatedParent.remaining_quantity);

        // 2. Tạo các lô con với mã sinh ngẫu nhiên
        const createdChildLots = [];
        for (let i = 0; i < splitItems.length; i++) {
          const item = splitItems[i];
          const splitQty = Number(item.quantity);
          const childName = (item.name && item.name.trim())
            ? item.name.trim()
            : `${parentLot.name} (Tách ${i + 1})`;
          const childStatus = item.status || parentLot.status || "Đã thu hoạch";

          let childLotId = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidateId = generateLotCode();
            try {
              const insertRes = await client.query(
                `INSERT INTO lots (
                  id, name, status, organization_id, farm_id, product_id,
                  initial_quantity, remaining_quantity, harvested_at, parent_lot_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [
                  candidateId,
                  childName,
                  childStatus,
                  parentLot.organization_id,
                  parentLot.farm_id,
                  parentLot.product_id,
                  splitQty,
                  splitQty,
                  parentLot.harvested_at,
                  parentLotId,
                ]
              );
              childLotId = candidateId;
              createdChildLots.push(insertRes.rows[0]);
              break;
            } catch (insErr) {
              if (insErr.code === "23505" && attempt < 4) continue;
              throw insErr;
            }
          }

          if (!childLotId) {
            throw new Error("Không thể sinh mã duy nhất cho lô con.");
          }

          // Ghi nhận liên kết lô mẹ - lô con vào bảng batch_relations (T-39)
          await client.query(
            `INSERT INTO batch_relations (
              parent_batch_id, child_batch_id, relation_type, quantity, organization_id
            ) VALUES ($1, $2, 'SPLIT', $3, $4)`,
            [parentLotId, childLotId, splitQty, parentLot.organization_id]
          );

          // Ghi sự kiện CREATED_FROM_SPLIT vào chuỗi sự kiện của lô con
          await appendBatchEvent(client, {
            batchId: childLotId,
            eventType: "CREATED_FROM_SPLIT",
            payload: {
              parentLotId,
              childLotId,
              quantity: splitQty,
              notes: item.notes || null,
              step: `Tạo từ phân tách lô mẹ ${parentLotId}`,
            },
            organizationId: parentLot.organization_id,
            actorUserId: userId,
            occurredAt: new Date(),
          });
        }

        // 3. Ghi sự kiện LOT_SPLIT vào chuỗi sự kiện của lô mẹ
        const parentEvent = await appendBatchEvent(client, {
          batchId: parentLotId,
          eventType: "LOT_SPLIT",
          payload: {
            parentLotId,
            childLotIds: createdChildLots.map((c) => c.id),
            totalSplitQuantity,
            remainingQuantity: newRemaining,
            splits: createdChildLots.map((c) => ({
              childLotId: c.id,
              name: c.name,
              quantity: Number(c.initial_quantity),
            })),
            step: `Phân tách thành ${createdChildLots.length} lô con (${createdChildLots.map((c) => c.id).join(", ")})`,
          },
          organizationId: parentLot.organization_id,
          actorUserId: userId,
          occurredAt: new Date(),
        });

        await client.query("COMMIT");

        return res.status(201).json({
          message: "Tách lô hàng thành công.",
          parentLot: {
            id: updatedParent.id,
            remainingQuantity: Number(updatedParent.remaining_quantity),
          },
          childLots: createdChildLots.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            initialQuantity: Number(c.initial_quantity),
            remainingQuantity: Number(c.remaining_quantity),
            parentLotId: c.parent_lot_id,
            organizationId: c.organization_id,
            createdAt: c.created_at,
          })),
          event: parentEvent,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        return res.status(500).json({ message: err.message });
      } finally {
        client.release();
      }
    } else {
      // In-Memory Mode
      const parentLot = inMemoryLots.find((l) => l.id === parentLotId);
      if (!parentLot) {
        return res.status(404).json({
          error: "LOT_NOT_FOUND",
          message: "Không tìm thấy lô hàng mẹ cần tách.",
        });
      }

      const pOrg = parentLot.organizationId || parentLot.organization_id;
      if (!isAdmin && pOrg !== userOrgId) {
        logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
          userId,
          userEmail: req.auth.email,
          userOrgId,
          userRole: req.auth.roleId,
          resourceType: "lots",
          resourceId: parentLotId,
          targetOrgId: pOrg,
          action: "SPLIT",
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Truy cập bị từ chối: bạn không có quyền tách lô hàng của tổ chức khác.",
        });
      }

      // Kiểm tra nếu lô đang chờ xác nhận bàn giao
      const pendingTransfer = inMemoryTransfers.find((t) => t.lotId === parentLotId && t.status === "PENDING");
      if (pendingTransfer) {
        return res.status(400).json({
          error: "PENDING_TRANSFER_EXISTS",
          message: "Không thể tách lô hàng đang trong trạng thái chờ xác nhận bàn giao.",
        });
      }

      const parentRemaining = Number(
        parentLot.remainingQuantity !== undefined ? parentLot.remainingQuantity : parentLot.remaining_quantity
      );
      const parentRemainingMilli = toMilliUnits(parentRemaining, true);
      if (totalSplitMilli > parentRemainingMilli) {
        return res.status(400).json({
          error: "EXCEEDS_REMAINING_QUANTITY",
          message: `Tổng khối lượng tách (${totalSplitQuantity.toFixed(3)}) vượt quá khối lượng còn lại của lô mẹ (${parentRemaining.toFixed(3)}).`,
        });
      }

      // Trừ khối lượng còn lại của lô mẹ chuẩn xác theo milli-units (T-42)
      const oldRemaining = parentRemaining;
      const newRemaining = fromMilliUnits(parentRemainingMilli - totalSplitMilli);
      parentLot.remainingQuantity = newRemaining;
      if (parentLot.remaining_quantity !== undefined) parentLot.remaining_quantity = newRemaining;

      const createdChildLots = [];
      const rollbackChildLots = [];

      try {
        const nowIso = new Date().toISOString();
        for (let i = 0; i < splitItems.length; i++) {
          const item = splitItems[i];
          const splitQty = Number(item.quantity);
          const childName = (item.name && item.name.trim())
            ? item.name.trim()
            : `${parentLot.name} (Tách ${i + 1})`;
          const childStatus = item.status || parentLot.status || "Đã thu hoạch";

          let childLotId = generateLotCode();
          while (inMemoryLots.some((l) => l.id === childLotId)) {
            childLotId = generateLotCode();
          }

          const newLot = {
            id: childLotId,
            name: childName,
            status: childStatus,
            organizationId: pOrg,
            farmId: parentLot.farmId || parentLot.farm_id || null,
            productId: parentLot.productId || parentLot.product_id || null,
            initialQuantity: splitQty,
            remainingQuantity: splitQty,
            harvestedAt: parentLot.harvestedAt || parentLot.harvested_at || null,
            parentLotId: parentLotId,
            createdAt: nowIso,
          };

          inMemoryLots.push(newLot);
          rollbackChildLots.push(newLot.id);
          createdChildLots.push(newLot);

          if (inMemoryBatchRelations.some((r) => r.parentBatchId === parentLotId && r.childBatchId === childLotId)) {
            const dupErr = new Error('duplicate key value violates unique constraint "uq_batch_relations_parent_child"');
            dupErr.code = "23505";
            throw dupErr;
          }

          inMemoryBatchRelations.push({
            id: `rel-${crypto.randomUUID().slice(0, 12)}`,
            parentBatchId: parentLotId,
            childBatchId: childLotId,
            relationType: "SPLIT",
            quantity: splitQty,
            organizationId: pOrg,
            createdAt: nowIso,
          });

          await appendBatchEvent(null, {
            batchId: childLotId,
            eventType: "CREATED_FROM_SPLIT",
            payload: {
              parentLotId,
              childLotId,
              quantity: splitQty,
              notes: item.notes || null,
              step: `Tạo từ phân tách lô mẹ ${parentLotId}`,
            },
            organizationId: pOrg,
            actorUserId: userId,
            occurredAt: new Date(),
          });
        }

        const parentEvent = await appendBatchEvent(null, {
          batchId: parentLotId,
          eventType: "LOT_SPLIT",
          payload: {
            parentLotId,
            childLotIds: createdChildLots.map((c) => c.id),
            totalSplitQuantity,
            remainingQuantity: newRemaining,
            splits: createdChildLots.map((c) => ({
              childLotId: c.id,
              name: c.name,
              quantity: c.initialQuantity,
            })),
            step: `Phân tách thành ${createdChildLots.length} lô con (${createdChildLots.map((c) => c.id).join(", ")})`,
          },
          organizationId: pOrg,
          actorUserId: userId,
          occurredAt: new Date(),
        });

        return res.status(201).json({
          message: "Tách lô hàng thành công.",
          parentLot: {
            id: parentLot.id,
            remainingQuantity: newRemaining,
          },
          childLots: createdChildLots.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            initialQuantity: c.initialQuantity,
            remainingQuantity: c.remainingQuantity,
            parentLotId: c.parentLotId,
            organizationId: c.organizationId,
            createdAt: c.createdAt,
          })),
          event: parentEvent,
        });
      } catch (memErr) {
        parentLot.remainingQuantity = oldRemaining;
        if (parentLot.remaining_quantity !== undefined) parentLot.remaining_quantity = oldRemaining;
        for (const cid of rollbackChildLots) {
          const idx = inMemoryLots.findIndex((l) => l.id === cid);
          if (idx !== -1) inMemoryLots.splice(idx, 1);

          for (let rIdx = inMemoryBatchRelations.length - 1; rIdx >= 0; rIdx--) {
            if (inMemoryBatchRelations[rIdx].childBatchId === cid) {
              inMemoryBatchRelations.splice(rIdx, 1);
            }
          }

          for (let eIdx = inMemoryBatchEvents.length - 1; eIdx >= 0; eIdx--) {
            if (inMemoryBatchEvents[eIdx].batchId === cid) {
              inMemoryBatchEvents.splice(eIdx, 1);
            }
          }
        }
        return res.status(500).json({ message: memErr.message });
      }
    }
  }
);

/**
 * Lấy chuỗi sự kiện hash-chain và lịch sử nguồn gốc của lô hàng (S-10, S-11, S-21, S-23)
 */
app.get(
  ["/api/lots/:id/events", "/api/lots/:id/timeline", "/api/lots/:id/lineage", "/api/lots/:id/origins"],
  requirePermission(["producer", "cooperative", "transporter", "distributor", "org_admin", "admin", "inspector"]),
  async (req, res) => {
    const lotId = req.params.id;
    try {
      const access = await evaluateLotAccess({
        pool,
        authContext: req.auth,
        lotId,
        inMemoryLots,
      });

      if (access.status === "NOT_FOUND") {
        return res.status(404).json({ message: "Không tìm thấy lô hàng." });
      }

      if (!access.allowed) {
        logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
          userId: req.auth.userId || req.auth.id,
          userEmail: req.auth.email,
          userOrgId: req.auth.organizationId,
          userRole: req.auth.roleId,
          resourceType: "lots",
          resourceId: lotId,
          targetOrgId: access.targetOrgId,
          action: "READ_EVENTS",
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
        return res.status(403).json({
          message: "Bạn không có quyền truy cập dữ liệu của tổ chức khác.",
        });
      }

      const allEventsRaw = await getBatchEvents(pool, lotId);
      const integrityCheck = verifyBatchEventChain(allEventsRaw);

      return res.status(200).json({
        lotId,
        accessType: access.accessType,
        events: access.events,
        ancestorEvents: access.ancestorEvents,
        ancestors: access.ancestors,
        count: access.events.length,
        isIntegrityValid: integrityCheck.valid,
        integrityError: integrityCheck.error || null,
        integrityDetails: integrityCheck,
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);
/**
 * Kiểm tra tính toàn vẹn chuỗi sự kiện và ghi nhận lịch sử kiểm tra (S-12 / T-28, T-29)
 * Dành riêng cho cán bộ kiểm tra (inspector) và quản trị viên (admin).
 */
app.get(
  "/api/lots/:id/integrity",
  requirePermission(["inspector", "admin"]),
  async (req, res) => {
    const lotId = req.params.id;

    if (pool) {
      try {
        const lotRes = await pool.query(
          "SELECT id, organization_id FROM lots WHERE id = $1",
          [lotId]
        );
        if (lotRes.rows.length === 0) {
          return res.status(404).json({ message: "Không tìm thấy lô hàng." });
        }

        // Đọc danh sách sự kiện duy nhất 1 lần để đảm bảo tính nguyên tử (atomic snapshot)
        const events = await getBatchEvents(pool, lotId);
        const integrity = verifyBatchEventChain(events);
        const isNoEvents = !events || events.length === 0;
        if (isNoEvents) {
          integrity.status = "NO_EVENTS";
        }

        const checkId = `CHK-${crypto.randomUUID()}`;
        const checkedAt = new Date().toISOString();
        const checkedBy = req.auth ? (req.auth.userId || req.auth.id || req.auth.email) : null;
        let auditLogged = false;

        // Lưu vào bảng integrity_checks (T-29): nếu lô 0 events, ghi error_type = 'NO_EVENTS'
        try {
          await pool.query(
            `INSERT INTO integrity_checks (
              id, batch_id, checked_by, checked_at, valid,
              first_invalid_sequence, error_type, final_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              checkId,
              lotId,
              checkedBy,
              checkedAt,
              integrity.valid,
              integrity.firstInvalidSequence || null,
              isNoEvents ? "NO_EVENTS" : (integrity.type || null),
              integrity.finalHash || null,
            ]
          );
          auditLogged = true;
        } catch (auditErr) {
          console.error("[Integrity Audit Log Error]:", auditErr.message);
          auditLogged = false;
        }

        return res.status(200).json({
          lotId,
          checkedAt,
          integrity,
          events,
          auditLogged,
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    // In-memory fallback
    const lot = inMemoryLots.find((l) => l.id === lotId);
    if (!lot) {
      return res.status(404).json({ message: "Không tìm thấy lô hàng." });
    }

    // Đọc danh sách sự kiện duy nhất 1 lần từ inMemoryBatchEvents
    const events = await getBatchEvents(null, lotId);
    const integrity = verifyBatchEventChain(events);
    const isNoEvents = !events || events.length === 0;
    if (isNoEvents) {
      integrity.status = "NO_EVENTS";
    }
    const checkedAt = new Date().toISOString();
    const checkId = `CHK-${crypto.randomUUID()}`;
    const checkedBy = req.auth ? (req.auth.userId || req.auth.id || req.auth.email) : null;

    inMemoryIntegrityChecks.push({
      id: checkId,
      batchId: lotId,
      checkedBy,
      checkedAt,
      valid: integrity.valid,
      status: isNoEvents ? "UNVERIFIABLE" : (integrity.valid ? "VALID" : "INVALID"),
      errorType: isNoEvents ? "NO_EVENTS" : (integrity.type || null),
      firstInvalidSequence: integrity.firstInvalidSequence || null,
      finalHash: integrity.finalHash || null,
    });

    return res.status(200).json({
      lotId,
      checkedAt,
      integrity,
      events,
      auditLogged: true,
    });
  }
);

/**
 * Ghi nhận lô thu hoạch (T-20, S-08, S-09, S-10)
 * Chặn dữ liệu không hợp lệ tại máy chủ (S-09):
 * - AC1: Ngày thu hoạch không được nằm trong tương lai (400)
 * - AC2: Khối lượng phải là số dương lớn hơn 0 (400)
 * - AC3: Kiểm tra quyền sở hữu thửa đất thuộc tổ chức (403 + security log)
 * - AC4: Chống tạo trùng lô khi bấm lưu nhiều lần / idempotency (X-Idempotency-Key / requestId / double-click fingerprint)
 * Chuỗi sự kiện có mã băm bảo vệ tính toàn vẹn (S-10):
 * - INSERT lot + appendBatchEvent(HARVEST_CREATED) nằm trong cùng transaction nguyên tử (nếu event lỗi -> rollback lot).
 */
app.post(
  "/api/lots",
  requirePermission(["producer", "cooperative", "org_admin", "admin"]),
  async (req, res) => {
    const { farmId, productId, quantity, harvestedAt } = req.body;
    const orgId = req.auth.organizationId;
    const userId = req.auth.userId || req.auth.id || req.auth.email || "user";

    const errors = {};

    // 1. Kiểm tra thửa đất và sản phẩm bắt buộc (T-21, T-22)
    if (!farmId) {
      errors.farmId = "Vui lòng chọn thửa đất.";
    }
    if (!productId) {
      errors.productId = "Vui lòng chọn sản phẩm.";
    }

    // 2. AC2: Khối lượng phải là số dương lớn hơn 0 (T-21, T-22)
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.quantity = "Khối lượng phải là số dương lớn hơn 0.";
    }

    // 3. AC1: Ngày thu hoạch không được nằm trong tương lai (T-21, T-22)
    let harvestDate;
    if (harvestedAt) {
      const parsedDate = new Date(harvestedAt);
      if (isNaN(parsedDate.getTime())) {
        errors.harvestedAt = "Ngày thu hoạch không hợp lệ.";
      } else {
        const inputDateStr = typeof harvestedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(harvestedAt.trim())
          ? harvestedAt.trim()
          : parsedDate.toISOString().slice(0, 10);
        const todayStr = new Date().toISOString().slice(0, 10);
        if (inputDateStr > todayStr) {
          errors.harvestedAt = "Ngày thu hoạch không được nằm trong tương lai.";
        } else {
          harvestDate = inputDateStr;
        }
      }
    } else {
      harvestDate = new Date().toISOString().slice(0, 10);
    }

    if (Object.keys(errors).length > 0) {
      const firstMessage = errors.farmId || errors.productId || errors.quantity || errors.harvestedAt;
      return res.status(400).json({
        message: firstMessage,
        errors,
      });
    }

    // 4. AC4: Idempotency & chống bấm lưu 2 lần
    const idempotencyKey = req.get("X-Idempotency-Key") || req.body.requestId || req.body.idempotencyKey;
    const idempotencyLookupKey = idempotencyKey ? `${orgId}:${idempotencyKey}` : null;
    const fingerprintKey = `fp:${orgId}:${userId}:${farmId}:${productId}:${qty}:${harvestDate}`;

    if (idempotencyLookupKey && harvestIdempotencyCache.has(idempotencyLookupKey)) {
      const cached = harvestIdempotencyCache.get(idempotencyLookupKey);
      return res.status(cached.status).json(cached.body);
    }

    const recentFp = harvestIdempotencyCache.get(fingerprintKey);
    if (recentFp && Date.now() - recentFp.createdAt < 2500) {
      return res.status(recentFp.status).json(recentFp.body);
    }

    const MAX_RETRIES = 5;
    let insertedLot = null;

    if (pool) {
      const client = await pool.connect();
      try {
        // 5. AC3: Kiểm tra thửa đất thuộc tổ chức hiện tại qua scopedQueryById
        const farmRes = await scopedQueryById(client, req.auth, "farms", farmId);
        if (farmRes.isCrossTenant) {
          logSecurityEvent("CROSS_TENANT_MUTATION_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: orgId,
            userRole: req.auth.roleId,
            resourceType: "farms",
            resourceId: farmId,
            targetOrgId: farmRes.targetOrgId,
            action: "HARVEST_ON_FOREIGN_FARM",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({ message: "Bạn không có quyền thao tác trên thửa đất của tổ chức khác." });
        }
        if (!farmRes.row) {
          return res.status(404).json({ message: "Không tìm thấy thửa đất." });
        }
        const farm = farmRes.row;

        // 6. Kiểm tra sản phẩm tồn tại
        const prodRes = await scopedQueryById(client, req.auth, "products", productId);
        if (!prodRes.row) {
          return res.status(400).json({
            message: "Sản phẩm không tồn tại trong danh mục.",
            errors: { productId: "Sản phẩm không tồn tại trong danh mục." },
          });
        }
        const product = prodRes.row;
        const lotName = req.body.name || `${product.name} - ${farm.name}`;
        const status = "Đã thu hoạch";

        // S-10: Bắt đầu transaction nguyên tử cho INSERT lots + appendBatchEvent
        await client.query("BEGIN");

        // 7. Chèn lô mới với cơ chế retry tối đa 5 lần nếu collision mã (T-19)
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const lotId = generateLotCode();
          try {
            const insertRes = await client.query(
              `INSERT INTO lots (
                id, name, status, organization_id, farm_id, product_id,
                initial_quantity, remaining_quantity, harvested_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING *`,
              [lotId, lotName, status, orgId, farmId, productId, qty, qty, harvestDate]
            );

            const row = insertRes.rows[0];
            insertedLot = {
              id: row.id,
              name: row.name,
              status: row.status,
              organizationId: row.organization_id,
              farmId: row.farm_id,
              farmName: farm.name,
              productId: row.product_id,
              productName: product.name,
              unit: product.unit,
              initialQuantity: Number(row.initial_quantity),
              remainingQuantity: Number(row.remaining_quantity),
              harvestedAt: row.harvested_at,
            };
            break;
          } catch (insertErr) {
            if (insertErr.code === "23505" && attempt < MAX_RETRIES - 1) {
              continue;
            }
            throw insertErr;
          }
        }

        if (!insertedLot) {
          await client.query("ROLLBACK");
          return res.status(500).json({ message: "Không thể sinh mã lô duy nhất sau 5 lần thử." });
        }

        // S-10: Ghi nhận sự kiện khởi tạo HARVEST_CREATED với chuỗi hash trong cùng transaction
        const eventRecord = await appendBatchEvent(client, {
          batchId: insertedLot.id,
          eventType: "HARVEST_CREATED",
          payload: {
            farmId,
            productId,
            quantity: qty,
            harvestedAt: harvestDate,
          },
          organizationId: orgId,
          actorUserId: userId,
          occurredAt: new Date(),
        });

        await client.query("COMMIT");

        const successResponse = {
          message: "Ghi nhận thu hoạch thành công.",
          lot: insertedLot,
          event: eventRecord,
        };

        if (idempotencyLookupKey) {
          harvestIdempotencyCache.set(idempotencyLookupKey, {
            status: 201,
            body: successResponse,
            createdAt: Date.now(),
          });
        }
        harvestIdempotencyCache.set(fingerprintKey, {
          status: 201,
          body: successResponse,
          createdAt: Date.now(),
        });
        cleanupHarvestIdempotency();

        return res.status(201).json(successResponse);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ message: err.message });
      } finally {
        client.release();
      }
    }

    // In-memory fallback
    const farm = inMemoryFarms.find((f) => f.id === farmId);
    if (!farm) {
      return res.status(404).json({ message: "Không tìm thấy thửa đất." });
    }
    if (farm.organizationId !== orgId && req.auth.roleId !== "admin") {
      logSecurityEvent("CROSS_TENANT_MUTATION_DENIED", {
        userId: req.auth.userId || req.auth.id,
        userEmail: req.auth.email,
        userOrgId: orgId,
        userRole: req.auth.roleId,
        resourceType: "farms",
        resourceId: farmId,
        targetOrgId: farm.organizationId,
        action: "HARVEST_ON_FOREIGN_FARM",
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });
      return res.status(403).json({ message: "Bạn không có quyền thao tác trên thửa đất của tổ chức khác." });
    }

    const product = inMemoryProducts.find((p) => p.id === productId);
    if (!product) {
      return res.status(400).json({
        message: "Sản phẩm không tồn tại trong danh mục.",
        errors: { productId: "Sản phẩm không tồn tại trong danh mục." },
      });
    }

    const lotName = req.body.name || `${product.name} - ${farm.name}`;
    const status = "Đã thu hoạch";

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const lotId = generateLotCode();
      if (!inMemoryLots.some((l) => l.id === lotId)) {
        insertedLot = {
          id: lotId,
          name: lotName,
          status,
          organizationId: orgId,
          farmId,
          farmName: farm.name,
          productId,
          productName: product.name,
          unit: product.unit,
          initialQuantity: qty,
          remainingQuantity: qty,
          harvestedAt: harvestDate,
        };
        break;
      }
    }

    if (!insertedLot) {
      return res.status(500).json({ message: "Không thể sinh mã lô duy nhất sau 5 lần thử." });
    }

    // S-10: Ghi nhận sự kiện HARVEST_CREATED vào chuỗi hash chain
    // Đảm bảo tính atomic: nếu append event lỗi, không thêm lot vào inMemoryLots (rollback)
    let eventRecord;
    try {
      eventRecord = await appendBatchEvent(null, {
        batchId: insertedLot.id,
        eventType: "HARVEST_CREATED",
        payload: {
          farmId,
          productId,
          quantity: qty,
          harvestedAt: harvestDate,
        },
        organizationId: orgId,
        actorUserId: userId,
        occurredAt: new Date(),
      });
      inMemoryLots.push(insertedLot);
    } catch (eventErr) {
      // Rollback: đảm bảo lô không được thêm vào inMemoryLots
      const idx = inMemoryLots.findIndex((l) => l.id === insertedLot.id);
      if (idx !== -1) inMemoryLots.splice(idx, 1);
      return res.status(500).json({ message: "Lỗi ghi nhận chuỗi sự kiện lô hàng: " + eventErr.message });
    }

    const successResponse = {
      message: "Ghi nhận thu hoạch thành công.",
      lot: insertedLot,
      event: eventRecord,
    };

    if (idempotencyLookupKey) {
      harvestIdempotencyCache.set(idempotencyLookupKey, {
        status: 201,
        body: successResponse,
        createdAt: Date.now(),
      });
    }
    harvestIdempotencyCache.set(fingerprintKey, {
      status: 201,
      body: successResponse,
      createdAt: Date.now(),
    });
    cleanupHarvestIdempotency();

    return res.status(201).json(successResponse);
  }
);

/**
 * Thêm lô hàng - Tương thích ngược API cũ (T-11, T-13)
 */
app.post(
  "/api/organization/lots",
  requirePermission(["producer", "cooperative", "org_admin", "admin"]),
  async (req, res) => {
    // Nếu request truyền farmId và productId, chuyển tiếp xử lý theo nghiệp vụ thu hoạch mới (T-20)
    if (req.body.farmId && req.body.productId) {
      return app._router.handle({ ...req, url: "/api/lots", method: "POST" }, res);
    }

    const { id, name, status } = req.body;
    const orgId = req.auth.organizationId;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Tên lô hàng không được để trống." });
    }

    const lotStatus = status || "Đã thu hoạch";
    const MAX_RETRIES = 5;
    let finalLotId = id;

    if (pool) {
      try {
        let inserted = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          finalLotId = id || generateLotCode();
          try {
            await pool.query(
              "INSERT INTO lots (id, name, status, organization_id) VALUES ($1, $2, $3, $4)",
              [finalLotId, name.trim(), lotStatus, orgId]
            );
            inserted = true;
            break;
          } catch (insertErr) {
            if (insertErr.code === "23505" && !id && attempt < MAX_RETRIES - 1) {
              continue;
            }
            if (insertErr.code === "23505" && id) {
              return res.status(409).json({ message: "Mã lô hàng đã tồn tại." });
            }
            throw insertErr;
          }
        }
        if (!inserted) {
          return res.status(500).json({ message: "Không thể sinh mã lô duy nhất sau 5 lần thử." });
        }
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    } else {
      let inserted = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        finalLotId = id || generateLotCode();
        if (inMemoryLots.some((l) => l.id === finalLotId)) {
          if (id) {
            return res.status(409).json({ message: "Mã lô hàng đã tồn tại." });
          }
          continue;
        }
        inMemoryLots.push({
          id: finalLotId,
          name: name.trim(),
          status: lotStatus,
          organizationId: orgId,
        });
        inserted = true;
        break;
      }
      if (!inserted) {
        return res.status(500).json({ message: "Không thể sinh mã lô duy nhất sau 5 lần thử." });
      }
    }

    return res.status(201).json({
      message: "Tạo lô hàng thành công.",
      lot: { id: finalLotId, name: name.trim(), status: lotStatus, organizationId: orgId },
    });
  }
);


/**
 * Danh sách thửa đất của tổ chức (T-14, T-15)
 */
app.get(
  "/api/farms",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const isInspector = req.auth.isInspector;
    const orgId = req.auth.organizationId;

    if (pool) {
      try {
        const queryRes = await scopedQuery(pool, req.auth, "farms", {
          orderBy: "created_at DESC",
        });
        return res.status(200).json({
          organizationId: orgId,
          farms: queryRes.rows.map((r) => ({
            id: r.id,
            name: r.name,
            area: parseFloat(r.area),
            coordinates: r.coordinates,
            organizationId: r.organization_id,
          })),
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    const filtered = isInspector
      ? inMemoryFarms
      : inMemoryFarms.filter((f) => f.organizationId === orgId);

    return res.status(200).json({
      organizationId: orgId,
      farms: filtered,
    });
  }
);

/**
 * Chi tiết thửa đất - kiểm tra cách ly tổ chức (T-15)
 */
app.get(
  "/api/farms/:id",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const farmId = req.params.id;
    const isInspector = req.auth.isInspector;
    const orgId = req.auth.organizationId;

    let farm = null;
    if (pool) {
      try {
        const q = await scopedQueryById(pool, req.auth, "farms", farmId);
        if (q.isCrossTenant) {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "farms",
            resourceId: farmId,
            targetOrgId: q.targetOrgId,
            action: "READ",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
          });
        }
        if (q.row) {
          farm = {
            id: q.row.id,
            name: q.row.name,
            area: parseFloat(q.row.area),
            coordinates: q.row.coordinates,
            organizationId: q.row.organization_id,
          };
        }
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    } else {
      const match = inMemoryFarms.find((f) => f.id === farmId);
      if (match) {
        if (!isInspector && match.organizationId !== orgId && req.auth.roleId !== "admin") {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "farms",
            resourceId: farmId,
            targetOrgId: match.organizationId,
            action: "READ",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
          });
        }
        farm = match;
      }
    }

    if (!farm) {
      return res.status(404).json({ message: "Không tìm thấy thửa đất." });
    }

    return res.status(200).json({ farm });
  }
);

/**
 * Khai báo thửa đất mới - ràng buộc diện tích > 0 và lỗi đúng trường (T-14, T-15)
 */
app.post(
  "/api/farms",
  requirePermission(["producer", "cooperative", "org_admin", "admin"]),
  async (req, res) => {
    const orgId = req.auth.organizationId;
    const name = String(req.body.name || "").trim();
    const area = parseFloat(req.body.area);
    const coordinates = String(req.body.coordinates || "").trim();

    const errors = {};
    if (!name) {
      errors.name = "Tên thửa đất không được để trống.";
    }
    if (isNaN(area) || area <= 0) {
      errors.area = "Diện tích phải là số lớn hơn 0 ha.";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        message: errors.name || errors.area,
        errors,
      });
    }

    const farmId = req.body.id || ("FARM-" + Date.now().toString().slice(-4));

    if (pool) {
      try {
        const insertRes = await pool.query(
          "INSERT INTO farms (id, name, area, coordinates, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, area, coordinates, organization_id",
          [farmId, name, area, coordinates, orgId]
        );
        const r = insertRes.rows[0];
        return res.status(201).json({
          message: "Khai báo thửa đất thành công.",
          farm: {
            id: r.id,
            name: r.name,
            area: parseFloat(r.area),
            coordinates: r.coordinates,
            organizationId: r.organization_id,
          },
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    const newFarm = { id: farmId, name, area, coordinates, organizationId: orgId };
    inMemoryFarms.push(newFarm);
    return res.status(201).json({
      message: "Khai báo thửa đất thành công.",
      farm: newFarm,
    });
  }
);

/**
 * Chỉnh sửa thửa đất - Đổi tên không làm hỏng liên kết với lô (T-15)
 */
app.put(
  "/api/farms/:id",
  requirePermission(["producer", "cooperative", "org_admin", "admin"]),
  async (req, res) => {
    const farmId = req.params.id;
    const orgId = req.auth.organizationId;
    const name = String(req.body.name || "").trim();
    const area = parseFloat(req.body.area);
    const coordinates = String(req.body.coordinates || "").trim();

    let existing = null;
    if (pool) {
      try {
        const q = await scopedQueryById(pool, req.auth, "farms", farmId);
        if (q.isCrossTenant) {
          logSecurityEvent("CROSS_TENANT_MUTATION_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "farms",
            resourceId: farmId,
            targetOrgId: q.targetOrgId,
            action: "UPDATE",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền sửa dữ liệu của tổ chức khác.",
          });
        }
        if (q.row) {
          existing = {
            id: q.row.id,
            organizationId: q.row.organization_id,
          };
        }
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    } else {
      const match = inMemoryFarms.find((f) => f.id === farmId);
      if (match) {
        if (match.organizationId !== orgId && req.auth.roleId !== "admin") {
          logSecurityEvent("CROSS_TENANT_MUTATION_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "farms",
            resourceId: farmId,
            targetOrgId: match.organizationId,
            action: "UPDATE",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền sửa dữ liệu của tổ chức khác.",
          });
        }
        existing = match;
      }
    }

    if (!existing) {
      return res.status(404).json({ message: "Không tìm thấy thửa đất." });
    }

    const errors = {};
    if (!name) {
      errors.name = "Tên thửa đất không được để trống.";
    }
    if (isNaN(area) || area <= 0) {
      errors.area = "Diện tích phải là số lớn hơn 0 ha.";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        message: errors.name || errors.area,
        errors,
      });
    }

    if (pool) {
      try {
        let updateRes;
        if (req.auth.roleId === "admin") {
          updateRes = await pool.query(
            "UPDATE farms SET name = $1, area = $2, coordinates = $3, updated_at = NOW() WHERE id = $4 RETURNING id, name, area, coordinates, organization_id",
            [name, area, coordinates, farmId]
          );
        } else {
          updateRes = await pool.query(
            "UPDATE farms SET name = $1, area = $2, coordinates = $3, updated_at = NOW() WHERE id = $4 AND organization_id = $5 RETURNING id, name, area, coordinates, organization_id",
            [name, area, coordinates, farmId, orgId]
          );
        }
        const r = updateRes.rows[0];
        return res.status(200).json({
          message: "Cập nhật thửa đất thành công.",
          farm: {
            id: r.id,
            name: r.name,
            area: parseFloat(r.area),
            coordinates: r.coordinates,
            organizationId: r.organization_id,
          },
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    existing.name = name;
    existing.area = area;
    existing.coordinates = coordinates;

    return res.status(200).json({
      message: "Cập nhật thửa đất thành công.",
      farm: existing,
    });
  }
);

/**
 * Danh sách tổ chức trong hệ thống (S-15: phục vụ chọn bên nhận khi bàn giao)
 */
app.get(
  "/api/organizations",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    try {
      if (pool) {
        const result = await pool.query(
          "SELECT id, name, type FROM organizations ORDER BY name ASC"
        );
        return res.status(200).json({ organizations: result.rows });
      }
      return res.status(200).json({ organizations: inMemoryOrganizations });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * S-15: Gửi yêu cầu bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận (PENDING).
 * - Người đang giữ lô chọn một tổ chức khác để bàn giao.
 * - Khi gửi yêu cầu thì CHƯA chuyển quyền sở hữu ngay, mà tạo trạng thái PENDING.
 * - Trong thời gian chờ, lô vẫn thuộc tổ chức gửi.
 * - Hệ thống lưu yêu cầu bàn giao, CHẶN tạo 2 yêu cầu pending cho cùng một lô (409 Conflict).
 * - Chặn tự bàn giao cho chính mình (400 Bad Request).
 * - Chặn người không sở hữu lô bàn giao (403 Forbidden).
 * - Ghi sự kiện TRANSFER_INITIATED vào lịch sử chuỗi sự kiện có hash SHA-256 (batch_events).
 */
app.post(
  ["/api/lots/:id/transfers", "/api/transfers"],
  requirePermission(["producer", "cooperative", "transporter", "distributor", "org_admin", "admin"]),
  async (req, res) => {
    const lotId = req.params.id || req.body.lotId;
    const { toOrganizationId, notes } = req.body;
    const userId = req.auth.userId || req.auth.id;
    const userOrgId = req.auth.organizationId;
    const isAdmin = req.auth.roleId === "admin";

    if (!lotId) {
      return res.status(400).json({ message: "Mã lô hàng (lotId) là bắt buộc." });
    }

    if (!toOrganizationId || typeof toOrganizationId !== "string" || !toOrganizationId.trim()) {
      return res.status(400).json({ message: "Tổ chức nhận (toOrganizationId) là bắt buộc." });
    }

    const trimmedToOrgId = toOrganizationId.trim();

    try {
      // 1. Tìm thông tin lô hàng và kiểm tra cách ly đa tổ chức (T-12)
      let lot = null;
      if (pool) {
        const queryRes = await scopedQueryById(pool, req.auth, "lots", lotId);
        if (queryRes.isCrossTenant) {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId,
            userEmail: req.auth.email,
            userOrgId,
            userRole: req.auth.roleId,
            resourceType: "lots/transfers",
            resourceId: lotId,
            targetOrgId: queryRes.targetOrgId,
            action: "TRANSFER",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn chỉ có thể bàn giao lô hàng thuộc quyền quản lý của tổ chức mình.",
          });
        }
        if (queryRes.row) {
          const r = queryRes.row;
          lot = {
            id: r.id,
            name: r.name,
            status: r.status,
            organizationId: r.organization_id,
          };
        }
      } else {
        const found = inMemoryLots.find((l) => l.id === lotId);
        if (found) {
          lot = { ...found };
        }
      }

      if (!lot) {
        return res.status(404).json({ message: "Không tìm thấy lô hàng." });
      }

      const fromOrgId = lot.organizationId;

      // 2. Kiểm tra quyền sở hữu lô: Phải thuộc tổ chức hiện tại của user (trừ admin)
      if (!isAdmin && fromOrgId !== userOrgId) {
        logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
          userId,
          userEmail: req.auth.email,
          userOrgId,
          userRole: req.auth.roleId,
          resourceType: "lots/transfers",
          resourceId: lotId,
          targetOrgId: fromOrgId,
          action: "TRANSFER",
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
        return res.status(403).json({
          message: "Truy cập bị từ chối: bạn chỉ có thể bàn giao lô hàng thuộc quyền quản lý của tổ chức mình.",
        });
      }

      // 3. Chặn tự bàn giao cho chính tổ chức mình
      if (trimmedToOrgId === fromOrgId) {
        return res.status(400).json({
          error: "SAME_ORGANIZATION_TRANSFER",
          message: "Không thể bàn giao lô hàng cho chính tổ chức của bạn.",
        });
      }

      // 4. Kiểm tra tổ chức nhận có tồn tại trong hệ thống không
      let toOrgExists = false;
      let toOrgName = trimmedToOrgId;
      if (pool) {
        const orgCheck = await pool.query("SELECT id, name FROM organizations WHERE id = $1", [trimmedToOrgId]);
        if (orgCheck.rows[0]) {
          toOrgExists = true;
          toOrgName = orgCheck.rows[0].name;
        }
      } else {
        const orgObj = inMemoryOrganizations.find((o) => o.id === trimmedToOrgId);
        if (orgObj) {
          toOrgExists = true;
          toOrgName = orgObj.name;
        }
      }

      if (!toOrgExists) {
        return res.status(400).json({
          message: "Tổ chức nhận không tồn tại trong hệ thống.",
        });
      }

      // Lấy tên tổ chức gửi
      let fromOrgName = fromOrgId;
      if (pool) {
        const fromCheck = await pool.query("SELECT name FROM organizations WHERE id = $1", [fromOrgId]);
        if (fromCheck.rows[0]) fromOrgName = fromCheck.rows[0].name;
      } else {
        const fromObj = inMemoryOrganizations.find((o) => o.id === fromOrgId);
        if (fromObj) fromOrgName = fromObj.name;
      }

      const transferId = "trf-" + crypto.randomUUID().slice(0, 8);
      const cleanNotes = typeof notes === "string" ? notes.trim() : null;
      const now = new Date();

      // 5, 6, 7. Tạo bản ghi bàn giao và ghi sự kiện TRANSFER_INITIATED trong cùng một TRANSACTION nguyên tử (Atomicity)
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // 5.1 Kiểm tra xem lô đã có yêu cầu PENDING nào chưa (với FOR UPDATE để chống race condition)
          const pendingCheck = await client.query(
            "SELECT id, created_at FROM lot_transfers WHERE lot_id = $1 AND status = 'PENDING' FOR UPDATE",
            [lotId]
          );
          if (pendingCheck.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              error: "ALREADY_PENDING_TRANSFER",
              message: "Lô hàng đang có một yêu cầu bàn giao ở trạng thái Chờ xác nhận (PENDING). Không thể tạo thêm yêu cầu mới.",
              pendingTransferId: pendingCheck.rows[0].id,
            });
          }

          // 5.2 Thêm bản ghi bàn giao ở trạng thái PENDING
          const insertRes = await client.query(
            `INSERT INTO lot_transfers (
              id, lot_id, from_organization_id, to_organization_id,
              status, notes, created_by_user_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $7)
            RETURNING *`,
            [transferId, lotId, fromOrgId, trimmedToOrgId, cleanNotes, userId, now]
          );

          // 5.3 Ghi nhận sự kiện bàn giao TRANSFER_INITIATED vào cùng transaction chuỗi băm SHA-256 (K-01 / S-10 / S-15)
          const transferEvent = await appendBatchEvent(client, {
            batchId: lotId,
            eventType: "TRANSFER_INITIATED",
            payload: {
              transferId,
              fromOrganizationId: fromOrgId,
              fromOrganizationName: fromOrgName,
              toOrganizationId: trimmedToOrgId,
              toOrganizationName: toOrgName,
              notes: cleanNotes,
              status: "PENDING",
            },
            organizationId: fromOrgId,
            actorUserId: userId,
            occurredAt: now,
          });

          await client.query("COMMIT");

          const r = insertRes.rows[0];
          const createdTransfer = {
            id: r.id,
            lotId: r.lot_id,
            fromOrganizationId: r.from_organization_id,
            fromOrganizationName: fromOrgName,
            toOrganizationId: r.to_organization_id,
            toOrganizationName: toOrgName,
            status: r.status,
            isOverdue: Boolean(r.is_overdue),
            overdueAt: r.overdue_at || null,
            notes: r.notes,
            createdByUserId: r.created_by_user_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };

          return res.status(201).json({
            message: "Yêu cầu bàn giao lô hàng đã được gửi thành công ở trạng thái Chờ xác nhận (PENDING).",
            transfer: createdTransfer,
            event: {
              id: transferEvent.id,
              sequenceNo: transferEvent.sequenceNo,
              eventHash: transferEvent.eventHash,
            },
          });
        } catch (txErr) {
          await client.query("ROLLBACK");
          if (txErr.code === "23505" || (txErr.message && txErr.message.includes("idx_unique_pending_transfer_per_lot"))) {
            return res.status(409).json({
              error: "ALREADY_PENDING_TRANSFER",
              message: "Lô hàng đang có một yêu cầu bàn giao ở trạng thái Chờ xác nhận (PENDING). Không thể tạo thêm yêu cầu mới.",
            });
          }
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        // Chế độ in-memory: kiểm tra trùng lặp và hỗ trợ rollback nếu ghi hash event lỗi
        const existingPending = inMemoryTransfers.find(
          (t) => t.lotId === lotId && t.status === "PENDING"
        );
        if (existingPending) {
          return res.status(409).json({
            error: "ALREADY_PENDING_TRANSFER",
            message: "Lô hàng đang có một yêu cầu bàn giao ở trạng thái Chờ xác nhận (PENDING). Không thể tạo thêm yêu cầu mới.",
            pendingTransferId: existingPending.id,
          });
        }

        const createdTransfer = {
          id: transferId,
          lotId,
          fromOrganizationId: fromOrgId,
          fromOrganizationName: fromOrgName,
          toOrganizationId: trimmedToOrgId,
          toOrganizationName: toOrgName,
          status: "PENDING",
          isOverdue: false,
          overdueAt: null,
          notes: cleanNotes,
          createdByUserId: userId,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };

        inMemoryTransfers.push(createdTransfer);

        let transferEvent;
        try {
          transferEvent = await appendBatchEvent(null, {
            batchId: lotId,
            eventType: "TRANSFER_INITIATED",
            payload: {
              transferId,
              fromOrganizationId: fromOrgId,
              fromOrganizationName: fromOrgName,
              toOrganizationId: trimmedToOrgId,
              toOrganizationName: toOrgName,
              notes: cleanNotes,
              status: "PENDING",
            },
            organizationId: fromOrgId,
            actorUserId: userId,
            occurredAt: now,
          });
        } catch (memErr) {
          // Rollback in-memory transfer record
          const idx = inMemoryTransfers.findIndex((t) => t.id === transferId);
          if (idx >= 0) inMemoryTransfers.splice(idx, 1);
          throw memErr;
        }

        return res.status(201).json({
          message: "Yêu cầu bàn giao lô hàng đã được gửi thành công ở trạng thái Chờ xác nhận (PENDING).",
          transfer: createdTransfer,
          event: {
            id: transferEvent.id,
            sequenceNo: transferEvent.sequenceNo,
            eventHash: transferEvent.eventHash,
          },
        });
      }
    } catch (err) {
      if (err.code === "23505" || (err.message && err.message.includes("idx_unique_pending_transfer_per_lot"))) {
        return res.status(409).json({
          error: "ALREADY_PENDING_TRANSFER",
          message: "Lô hàng đang có một yêu cầu bàn giao ở trạng thái Chờ xác nhận (PENDING).",
        });
      }
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * Lấy danh sách yêu cầu bàn giao lô hàng (S-15, S-16)
 * - Lọc theo status (PENDING, CONFIRMED, REJECTED)
 * - Lọc theo type (outgoing: gửi đi, incoming: nhận về)
 * - Lọc theo lotId
 */
app.get(
  "/api/transfers",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const isGlobal = req.auth.isInspector || req.auth.roleId === "admin";
    const userOrgId = req.auth.organizationId;
    const { status, type, lotId } = req.query;

    try {
      if (pool) {
        let query = `
          SELECT 
            t.id, t.lot_id, t.from_organization_id, t.to_organization_id,
            t.status, t.notes, t.created_by_user_id, t.resolved_by_user_id,
            t.rejection_reason, t.is_overdue, t.overdue_at, t.created_at, t.updated_at,
            l.name AS lot_name, l.status AS lot_status,
            o_from.name AS from_organization_name,
            o_to.name AS to_organization_name
          FROM lot_transfers t
          JOIN lots l ON t.lot_id = l.id
          LEFT JOIN organizations o_from ON t.from_organization_id = o_from.id
          LEFT JOIN organizations o_to ON t.to_organization_id = o_to.id
          WHERE 1=1
        `;
        const params = [];

        if (!isGlobal) {
          if (type === "outgoing") {
            params.push(userOrgId);
            query += ` AND t.from_organization_id = $${params.length}`;
          } else if (type === "incoming") {
            params.push(userOrgId);
            query += ` AND t.to_organization_id = $${params.length}`;
          } else {
            params.push(userOrgId);
            query += ` AND (t.from_organization_id = $${params.length} OR t.to_organization_id = $${params.length})`;
          }
        }

        if (status) {
          params.push(status.toUpperCase());
          query += ` AND t.status = $${params.length}`;
        }

        if (lotId) {
          params.push(lotId);
          query += ` AND t.lot_id = $${params.length}`;
        }

        query += " ORDER BY t.created_at DESC";

        const result = await pool.query(query, params);
        return res.status(200).json({
          transfers: result.rows.map((r) => ({
            id: r.id,
            lotId: r.lot_id,
            lotName: r.lot_name,
            lotStatus: r.lot_status,
            fromOrganizationId: r.from_organization_id,
            fromOrganizationName: r.from_organization_name,
            toOrganizationId: r.to_organization_id,
            toOrganizationName: r.to_organization_name,
            status: r.status,
            isOverdue: Boolean(r.is_overdue),
            overdueAt: r.overdue_at || null,
            notes: r.notes,
            createdByUserId: r.created_by_user_id,
            resolvedByUserId: r.resolved_by_user_id,
            rejectionReason: r.rejection_reason,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })),
        });
      }

      // In-memory fallback
      let filtered = [...inMemoryTransfers];
      if (!isGlobal) {
        if (type === "outgoing") {
          filtered = filtered.filter((t) => t.fromOrganizationId === userOrgId);
        } else if (type === "incoming") {
          filtered = filtered.filter((t) => t.toOrganizationId === userOrgId);
        } else {
          filtered = filtered.filter(
            (t) => t.fromOrganizationId === userOrgId || t.toOrganizationId === userOrgId
          );
        }
      }

      if (status) {
        const st = status.toUpperCase();
        filtered = filtered.filter((t) => t.status === st);
      }

      if (lotId) {
        filtered = filtered.filter((t) => t.lotId === lotId);
      }

      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return res.status(200).json({
        transfers: filtered.map((t) => {
          const lot = inMemoryLots.find((l) => l.id === t.lotId);
          const fromOrg = inMemoryOrganizations.find((o) => o.id === t.fromOrganizationId);
          const toOrg = inMemoryOrganizations.find((o) => o.id === t.toOrganizationId);
          return {
            ...t,
            isOverdue: Boolean(t.isOverdue || t.is_overdue),
            overdueAt: t.overdueAt || t.overdue_at || null,
            lotName: lot ? lot.name : t.lotId,
            lotStatus: lot ? lot.status : "Đã thu hoạch",
            fromOrganizationName: fromOrg ? fromOrg.name : t.fromOrganizationId,
            toOrganizationName: toOrg ? toOrg.name : t.toOrganizationId,
          };
        }),
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * Lấy lịch sử yêu cầu bàn giao của một lô hàng cụ thể
 */
app.get(
  "/api/lots/:id/transfers",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const lotId = req.params.id;
    const isGlobal = req.auth.isInspector || req.auth.roleId === "admin";
    const userOrgId = req.auth.organizationId;

    try {
      if (pool) {
        const result = await pool.query(
          `SELECT 
            t.id, t.lot_id, t.from_organization_id, t.to_organization_id,
            t.status, t.notes, t.created_by_user_id, t.resolved_by_user_id,
            t.rejection_reason, t.is_overdue, t.overdue_at, t.created_at, t.updated_at,
            o_from.name AS from_organization_name,
            o_to.name AS to_organization_name
          FROM lot_transfers t
          LEFT JOIN organizations o_from ON t.from_organization_id = o_from.id
          LEFT JOIN organizations o_to ON t.to_organization_id = o_to.id
          WHERE t.lot_id = $1
          ORDER BY t.created_at DESC`,
          [lotId]
        );

        if (!isGlobal) {
          const hasAccess = result.rows.some(
            (r) => r.from_organization_id === userOrgId || r.to_organization_id === userOrgId
          );
          if (!hasAccess) {
            const lotQueryRes = await scopedQueryById(pool, req.auth, "lots", lotId);
            if (!lotQueryRes.row || lotQueryRes.isCrossTenant) {
              return res.status(403).json({
                message: "Truy cập bị từ chối: bạn không có quyền xem lịch sử bàn giao của lô này.",
              });
            }
          }
        }

        return res.status(200).json({
          transfers: result.rows.map((r) => ({
            id: r.id,
            lotId: r.lot_id,
            fromOrganizationId: r.from_organization_id,
            fromOrganizationName: r.from_organization_name,
            toOrganizationId: r.to_organization_id,
            toOrganizationName: r.to_organization_name,
            status: r.status,
            isOverdue: Boolean(r.is_overdue),
            overdueAt: r.overdue_at || null,
            notes: r.notes,
            createdByUserId: r.created_by_user_id,
            resolvedByUserId: r.resolved_by_user_id,
            rejectionReason: r.rejection_reason,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })),
        });
      }

      // In-memory fallback
      const transfers = inMemoryTransfers.filter((t) => t.lotId === lotId);
      if (!isGlobal) {
        const lot = inMemoryLots.find((l) => l.id === lotId);
        const hasAccess =
          (lot && lot.organizationId === userOrgId) ||
          transfers.some((t) => t.fromOrganizationId === userOrgId || t.toOrganizationId === userOrgId);

        if (!hasAccess) {
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền xem lịch sử bàn giao của lô này.",
          });
        }
      }

      transfers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return res.status(200).json({
        transfers: transfers.map((t) => {
          const fromOrg = inMemoryOrganizations.find((o) => o.id === t.fromOrganizationId);
          const toOrg = inMemoryOrganizations.find((o) => o.id === t.toOrganizationId);
          return {
            ...t,
            isOverdue: Boolean(t.isOverdue || t.is_overdue),
            overdueAt: t.overdueAt || t.overdue_at || null,
            fromOrganizationName: fromOrg ? fromOrg.name : t.fromOrganizationId,
            toOrganizationName: toOrg ? toOrg.name : t.toOrganizationId,
          };
        }),
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * Xác nhận tiếp nhận bàn giao lô hàng (S-16, T-37)
 * - Chỉ tổ chức tiếp nhận (to_organization_id) mới có quyền gọi.
 * - Kiểm tra transfer đang ở trạng thái PENDING; nếu đã xử lý -> 409 Conflict.
 * - Trong cùng transaction nguyên tử:
 *   + Cập nhật lots.organization_id = to_organization_id (chuyển quyền sở hữu lô).
 *   + Cập nhật lot_transfers.status = 'CONFIRMED', resolved_by_user_id = user.id.
 *   + Ghi sự kiện TRANSFER_CONFIRMED vào chuỗi băm SHA-256 (batch_events).
 *   + Nếu ghi event lỗi -> rollback toàn bộ (kể cả việc đổi chủ lô).
 */
app.post(
  "/api/transfers/:id/confirm",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "org_admin", "admin"]),
  async (req, res) => {
    if (req.auth.isInspector || req.auth.roleId === "inspector") {
      return res.status(403).json({
        error: "INSPECTOR_FORBIDDEN",
        message: "Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, không được phép xác nhận bàn giao.",
      });
    }

    const transferId = req.params.id;
    const userId = req.auth.id;
    const userOrgId = req.auth.organizationId;
    const now = new Date();

    try {
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const trRes = await client.query(
            `SELECT t.*, l.name AS lot_name, l.organization_id AS current_lot_org_id,
                    o_from.name AS from_org_name, o_to.name AS to_org_name
             FROM lot_transfers t
             JOIN lots l ON t.lot_id = l.id
             LEFT JOIN organizations o_from ON t.from_organization_id = o_from.id
             LEFT JOIN organizations o_to ON t.to_organization_id = o_to.id
             WHERE t.id = $1 FOR UPDATE OF t`,
            [transferId]
          );

          if (trRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
              error: "TRANSFER_NOT_FOUND",
              message: "Yêu cầu bàn giao không tồn tại.",
            });
          }

          const tr = trRes.rows[0];

          // S-16 AC4: Chỉ tổ chức tiếp nhận mới được xác nhận
          if (userOrgId !== tr.to_organization_id) {
            await client.query("ROLLBACK");
            return res.status(403).json({
              error: "FORBIDDEN",
              message: "Chỉ tổ chức tiếp nhận mới có quyền xác nhận bàn giao lô hàng.",
            });
          }

          // Kiểm tra trạng thái: chỉ PENDING mới được xử lý
          if (tr.status !== "PENDING") {
            await client.query("ROLLBACK");
            return res.status(409).json({
              error: "TRANSFER_ALREADY_RESOLVED",
              message: `Yêu cầu bàn giao đã được xử lý trước đó với trạng thái: ${tr.status}. Không thể xử lý lần hai.`,
            });
          }

          // 1. Chuyển quyền sở hữu lô sang tổ chức nhận (S-16 AC1)
          await client.query(
            "UPDATE lots SET organization_id = $1 WHERE id = $2",
            [tr.to_organization_id, tr.lot_id]
          );

          // 2. Cập nhật trạng thái transfer thành CONFIRMED và lưu resolved_by_user_id (S-16 AC1)
          const updateRes = await client.query(
            `UPDATE lot_transfers 
             SET status = 'CONFIRMED', resolved_by_user_id = $1, updated_at = $2 
             WHERE id = $3 
             RETURNING *`,
            [userId, now, tr.id]
          );

          // 3. Ghi event mới TRANSFER_CONFIRMED vào chuỗi băm SHA-256 bảo chứng (K-01 / S-10 / S-16 / S-24)
          const isLate = Boolean(tr.is_overdue);
          const confirmEvent = await appendBatchEvent(client, {
            batchId: tr.lot_id,
            eventType: "TRANSFER_CONFIRMED",
            payload: {
              transferId: tr.id,
              fromOrganizationId: tr.from_organization_id,
              fromOrganizationName: tr.from_org_name || tr.from_organization_id,
              toOrganizationId: tr.to_organization_id,
              toOrganizationName: tr.to_org_name || tr.to_organization_id,
              resolvedByUserId: userId,
              notes: tr.notes,
              status: "CONFIRMED",
              lateConfirmation: isLate,
            },
            organizationId: tr.to_organization_id,
            actorUserId: userId,
            occurredAt: now,
          });

          await client.query("COMMIT");

          const updated = updateRes.rows[0];
          return res.status(200).json({
            message: "Xác nhận tiếp nhận bàn giao thành công. Quyền sở hữu lô hàng đã được chuyển giao sang tổ chức của bạn.",
            transfer: {
              id: updated.id,
              lotId: updated.lot_id,
              fromOrganizationId: updated.from_organization_id,
              fromOrganizationName: tr.from_org_name,
              toOrganizationId: updated.to_organization_id,
              toOrganizationName: tr.to_org_name,
              status: updated.status,
              isOverdue: Boolean(updated.is_overdue),
              overdueAt: updated.overdue_at || null,
              lateConfirmation: isLate,
              notes: updated.notes,
              createdByUserId: updated.created_by_user_id,
              resolvedByUserId: updated.resolved_by_user_id,
              rejectionReason: updated.rejection_reason,
              createdAt: updated.created_at,
              updatedAt: updated.updated_at,
            },
            event: {
              id: confirmEvent.id,
              sequenceNo: confirmEvent.sequenceNo,
              eventHash: confirmEvent.eventHash,
            },
          });
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        // Fallback in-memory
        const tr = inMemoryTransfers.find((t) => t.id === transferId);
        if (!tr) {
          return res.status(404).json({
            error: "TRANSFER_NOT_FOUND",
            message: "Yêu cầu bàn giao không tồn tại.",
          });
        }

        // S-16 AC4: Chỉ tổ chức tiếp nhận mới được xác nhận
        if (userOrgId !== tr.toOrganizationId) {
          return res.status(403).json({
            error: "FORBIDDEN",
            message: "Chỉ tổ chức tiếp nhận mới có quyền xác nhận bàn giao lô hàng.",
          });
        }

        if (tr.status !== "PENDING") {
          return res.status(409).json({
            error: "TRANSFER_ALREADY_RESOLVED",
            message: `Yêu cầu bàn giao đã được xử lý trước đó với trạng thái: ${tr.status}. Không thể xử lý lần hai.`,
          });
        }

        const lot = inMemoryLots.find((l) => l.id === tr.lotId);
        if (!lot) {
          return res.status(404).json({ error: "LOT_NOT_FOUND", message: "Lô hàng không tồn tại." });
        }

        const oldLotOrgId = lot.organizationId;
        const oldTrStatus = tr.status;
        const oldTrResolvedBy = tr.resolvedByUserId;
        const oldTrUpdatedAt = tr.updatedAt;

        // 1. Đổi lots.organization_id sang tổ chức nhận (S-16 AC1)
        lot.organizationId = tr.toOrganizationId;
        tr.status = "CONFIRMED";
        tr.resolvedByUserId = userId;
        tr.updatedAt = now.toISOString();

        let confirmEvent;
        try {
          const fromOrg = inMemoryOrganizations.find((o) => o.id === tr.fromOrganizationId);
          const toOrg = inMemoryOrganizations.find((o) => o.id === tr.toOrganizationId);
          const isLate = Boolean(tr.isOverdue || tr.is_overdue);

          confirmEvent = await appendBatchEvent(null, {
            batchId: tr.lotId,
            eventType: "TRANSFER_CONFIRMED",
            payload: {
              transferId: tr.id,
              fromOrganizationId: tr.fromOrganizationId,
              fromOrganizationName: fromOrg ? fromOrg.name : tr.fromOrganizationId,
              toOrganizationId: tr.toOrganizationId,
              toOrganizationName: toOrg ? toOrg.name : tr.toOrganizationId,
              resolvedByUserId: userId,
              notes: tr.notes,
              status: "CONFIRMED",
              lateConfirmation: isLate,
            },
            organizationId: tr.toOrganizationId,
            actorUserId: userId,
            occurredAt: now,
          });
        } catch (memErr) {
          // Rollback nguyên tử cả đổi chủ và transfer nếu ghi event lỗi
          lot.organizationId = oldLotOrgId;
          tr.status = oldTrStatus;
          tr.resolvedByUserId = oldTrResolvedBy;
          tr.updatedAt = oldTrUpdatedAt;
          throw memErr;
        }

        const isLate = Boolean(tr.isOverdue || tr.is_overdue);
        return res.status(200).json({
          message: "Xác nhận tiếp nhận bàn giao thành công. Quyền sở hữu lô hàng đã được chuyển giao sang tổ chức của bạn.",
          transfer: {
            ...tr,
            isOverdue: Boolean(tr.isOverdue || tr.is_overdue),
            overdueAt: tr.overdueAt || tr.overdue_at || null,
            lateConfirmation: isLate,
          },
          event: {
            id: confirmEvent.id,
            sequenceNo: confirmEvent.sequenceNo,
            eventHash: confirmEvent.eventHash,
          },
        });
      }
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * Từ chối tiếp nhận bàn giao lô hàng (S-16, T-37)
 * - Chỉ tổ chức tiếp nhận (to_organization_id) mới có quyền gọi.
 * - Yêu cầu body có "reason" bắt buộc và có ít nhất 10 ký tự (Jira T-38, S-16 AC3).
 * - Lô hàng VẪN THUỘC TỔ CHỨC GỬI (lots.organization_id KHÔNG ĐỔI) (S-16 AC2).
 * - Cập nhật lot_transfers.status = 'REJECTED', resolved_by_user_id, rejection_reason.
 * - Ghi sự kiện TRANSFER_REJECTED kèm lý do vào chuỗi băm SHA-256 (batch_events).
 */
app.post(
  "/api/transfers/:id/reject",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "org_admin", "admin"]),
  async (req, res) => {
    if (req.auth.isInspector || req.auth.roleId === "inspector") {
      return res.status(403).json({
        error: "INSPECTOR_FORBIDDEN",
        message: "Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, không được phép từ chối bàn giao.",
      });
    }

    const { reason } = req.body || {};
    const cleanReason = typeof reason === "string" ? reason.trim() : "";

    // S-16 AC3: Lý do bắt buộc, Jira T-38 yêu cầu ít nhất 10 ký tự
    if (!cleanReason || cleanReason.length < 10) {
      return res.status(400).json({
        error: "INVALID_REASON",
        message: "Lý do từ chối là bắt buộc và phải có ít nhất 10 ký tự.",
      });
    }

    const transferId = req.params.id;
    const userId = req.auth.id;
    const userOrgId = req.auth.organizationId;
    const now = new Date();

    try {
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const trRes = await client.query(
            `SELECT t.*, l.name AS lot_name, l.organization_id AS current_lot_org_id,
                    o_from.name AS from_org_name, o_to.name AS to_org_name
             FROM lot_transfers t
             JOIN lots l ON t.lot_id = l.id
             LEFT JOIN organizations o_from ON t.from_organization_id = o_from.id
             LEFT JOIN organizations o_to ON t.to_organization_id = o_to.id
             WHERE t.id = $1 FOR UPDATE OF t`,
            [transferId]
          );

          if (trRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
              error: "TRANSFER_NOT_FOUND",
              message: "Yêu cầu bàn giao không tồn tại.",
            });
          }

          const tr = trRes.rows[0];

          // S-16 AC4: Chỉ tổ chức tiếp nhận mới được từ chối
          if (userOrgId !== tr.to_organization_id) {
            await client.query("ROLLBACK");
            return res.status(403).json({
              error: "FORBIDDEN",
              message: "Chỉ tổ chức tiếp nhận mới có quyền từ chối bàn giao lô hàng.",
            });
          }

          // Kiểm tra trạng thái: chỉ PENDING mới được xử lý
          if (tr.status !== "PENDING") {
            await client.query("ROLLBACK");
            return res.status(409).json({
              error: "TRANSFER_ALREADY_RESOLVED",
              message: `Yêu cầu bàn giao đã được xử lý trước đó với trạng thái: ${tr.status}. Không thể xử lý lần hai.`,
            });
          }

          // S-16 AC2: Lô hàng vẫn thuộc bên gửi (lots.organization_id KHÔNG ĐỔI)
          // Cập nhật trạng thái transfer thành REJECTED, lưu lý do và resolved_by_user_id
          const updateRes = await client.query(
            `UPDATE lot_transfers 
             SET status = 'REJECTED', resolved_by_user_id = $1, rejection_reason = $2, updated_at = $3 
             WHERE id = $4 
             RETURNING *`,
            [userId, cleanReason, now, tr.id]
          );

          // Ghi event mới TRANSFER_REJECTED vào chuỗi băm SHA-256 bảo chứng (K-01 / S-10 / S-16)
          const rejectEvent = await appendBatchEvent(client, {
            batchId: tr.lot_id,
            eventType: "TRANSFER_REJECTED",
            payload: {
              transferId: tr.id,
              fromOrganizationId: tr.from_organization_id,
              fromOrganizationName: tr.from_org_name || tr.from_organization_id,
              toOrganizationId: tr.to_organization_id,
              toOrganizationName: tr.to_org_name || tr.to_organization_id,
              resolvedByUserId: userId,
              reason: cleanReason,
              status: "REJECTED",
            },
            organizationId: tr.to_organization_id,
            actorUserId: userId,
            occurredAt: now,
          });

          await client.query("COMMIT");

          const updated = updateRes.rows[0];
          return res.status(200).json({
            message: "Từ chối tiếp nhận bàn giao thành công. Lô hàng vẫn thuộc quyền sở hữu của bên gửi.",
            transfer: {
              id: updated.id,
              lotId: updated.lot_id,
              fromOrganizationId: updated.from_organization_id,
              fromOrganizationName: tr.from_org_name,
              toOrganizationId: updated.to_organization_id,
              toOrganizationName: tr.to_org_name,
              status: updated.status,
              isOverdue: Boolean(updated.is_overdue),
              overdueAt: updated.overdue_at || null,
              notes: updated.notes,
              createdByUserId: updated.created_by_user_id,
              resolvedByUserId: updated.resolved_by_user_id,
              rejectionReason: updated.rejection_reason,
              createdAt: updated.created_at,
              updatedAt: updated.updated_at,
            },
            event: {
              id: rejectEvent.id,
              sequenceNo: rejectEvent.sequenceNo,
              eventHash: rejectEvent.eventHash,
            },
          });
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        // Fallback in-memory
        const tr = inMemoryTransfers.find((t) => t.id === transferId);
        if (!tr) {
          return res.status(404).json({
            error: "TRANSFER_NOT_FOUND",
            message: "Yêu cầu bàn giao không tồn tại.",
          });
        }

        // S-16 AC4: Chỉ tổ chức tiếp nhận mới được từ chối
        if (userOrgId !== tr.toOrganizationId) {
          return res.status(403).json({
            error: "FORBIDDEN",
            message: "Chỉ tổ chức tiếp nhận mới có quyền từ chối bàn giao lô hàng.",
          });
        }

        if (tr.status !== "PENDING") {
          return res.status(409).json({
            error: "TRANSFER_ALREADY_RESOLVED",
            message: `Yêu cầu bàn giao đã được xử lý trước đó với trạng thái: ${tr.status}. Không thể xử lý lần hai.`,
          });
        }

        const oldTrStatus = tr.status;
        const oldTrResolvedBy = tr.resolvedByUserId;
        const oldTrReason = tr.rejectionReason;
        const oldTrUpdatedAt = tr.updatedAt;

        // Lô hàng vẫn thuộc bên gửi (lots.organization_id KHÔNG ĐỔI)
        tr.status = "REJECTED";
        tr.resolvedByUserId = userId;
        tr.rejectionReason = cleanReason;
        tr.updatedAt = now.toISOString();

        let rejectEvent;
        try {
          const fromOrg = inMemoryOrganizations.find((o) => o.id === tr.fromOrganizationId);
          const toOrg = inMemoryOrganizations.find((o) => o.id === tr.toOrganizationId);

          rejectEvent = await appendBatchEvent(null, {
            batchId: tr.lotId,
            eventType: "TRANSFER_REJECTED",
            payload: {
              transferId: tr.id,
              fromOrganizationId: tr.fromOrganizationId,
              fromOrganizationName: fromOrg ? fromOrg.name : tr.fromOrganizationId,
              toOrganizationId: tr.toOrganizationId,
              toOrganizationName: toOrg ? toOrg.name : tr.toOrganizationId,
              resolvedByUserId: userId,
              reason: cleanReason,
              status: "REJECTED",
            },
            organizationId: tr.toOrganizationId,
            actorUserId: userId,
            occurredAt: now,
          });
        } catch (memErr) {
          tr.status = oldTrStatus;
          tr.resolvedByUserId = oldTrResolvedBy;
          tr.rejectionReason = oldTrReason;
          tr.updatedAt = oldTrUpdatedAt;
          throw memErr;
        }

        return res.status(200).json({
          message: "Từ chối tiếp nhận bàn giao thành công. Lô hàng vẫn thuộc quyền sở hữu của bên gửi.",
          transfer: {
            ...tr,
            isOverdue: Boolean(tr.isOverdue || tr.is_overdue),
            overdueAt: tr.overdueAt || tr.overdue_at || null,
          },
          event: {
            id: rejectEvent.id,
            sequenceNo: rejectEvent.sequenceNo,
            eventHash: rejectEvent.eventHash,
          },
        });
      }
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
);

/**
 * Giả lập yêu cầu bàn giao quá hạn phục vụ kiểm thử trực tiếp (S-24 / T-56 / T-57)
 * - Cho phép sửa created_at của yêu cầu bàn giao PENDING thành N giờ trước (mặc định 49h).
 * - Tự động kích hoạt job quét markOverdueTransfers để chuyển trạng thái isOverdue = true ngay lập tức.
 */
app.post("/api/transfers/simulate-overdue", async (req, res) => {
  const { transferId, lotId, hours = 49 } = req.body || {};
  const targetHours = Number(hours) || 49;
  const simulatedTime = new Date(Date.now() - targetHours * 3600 * 1000).toISOString();

  try {
    if (pool) {
      let query = `
        UPDATE lot_transfers 
        SET created_at = NOW() - ($1 || ' hours')::INTERVAL, 
            is_overdue = FALSE, 
            overdue_at = NULL 
        WHERE status = 'PENDING'
      `;
      const params = [targetHours];

      if (transferId) {
        params.push(transferId);
        query += ` AND id = $${params.length}`;
      } else if (lotId) {
        params.push(lotId);
        query += ` AND lot_id = $${params.length}`;
      }
      query += " RETURNING *";

      const result = await pool.query(query, params);
      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "NO_PENDING_TRANSFER_FOUND",
          message: "Không tìm thấy yêu cầu bàn giao PENDING nào để giả lập quá hạn. Hãy tạo một yêu cầu bàn giao trước.",
        });
      }

      // Kích hoạt ngay job quét rà soát bàn giao quá hạn
      const jobResult = await markOverdueTransfers({ pool, hours: 48 });

      return res.status(200).json({
        message: `Đã giả lập thành công ${result.rows.length} yêu cầu bàn giao thành ${targetHours} giờ trước và kích hoạt job quét đánh dấu QUÁ HẠN.`,
        transfers: result.rows.map((r) => ({
          id: r.id,
          lotId: r.lot_id,
          status: r.status,
          isOverdue: true,
          overdueAt: new Date().toISOString(),
          createdAt: r.created_at,
        })),
        jobResult,
      });
    }

    // In-memory mode
    let candidates = inMemoryTransfers.filter((t) => t.status === "PENDING");
    if (transferId) candidates = candidates.filter((t) => t.id === transferId);
    if (lotId) candidates = candidates.filter((t) => t.lotId === lotId);

    if (candidates.length === 0) {
      // Nếu chưa có transfer PENDING nào, tạo 1 transfer giả lập cho LOT-002 hoặc LOT-001
      const lot = inMemoryLots.find((l) => l.organizationId === "org-001") || inMemoryLots[0];
      const newTransferId = `TR-OVERDUE-${Date.now().toString().slice(-4)}`;
      const newTr = {
        id: newTransferId,
        lotId: lot ? lot.id : "LOT-001",
        fromOrganizationId: "org-001",
        fromOrganizationName: "Nông trại Thái Nguyên",
        toOrganizationId: "org-002",
        toOrganizationName: "Hợp tác xã Rau Sạch Bắc Giang",
        status: "PENDING",
        isOverdue: false,
        overdueAt: null,
        notes: `Yêu cầu bàn giao giả lập ${targetHours} giờ trước để test S-24`,
        createdByUserId: "usr-001",
        createdAt: simulatedTime,
        updatedAt: simulatedTime,
      };
      inMemoryTransfers.push(newTr);
      candidates = [newTr];
    } else {
      candidates.forEach((t) => {
        t.createdAt = simulatedTime;
        t.isOverdue = false;
        t.is_overdue = false;
        t.overdueAt = null;
        t.overdue_at = null;
      });
    }

    // Kích hoạt ngay job quét rà soát bàn giao quá hạn
    const jobResult = await markOverdueTransfers({ inMemoryTransfers, hours: 48 });

    return res.status(200).json({
      message: `Đã giả lập thành công ${candidates.length} yêu cầu bàn giao thành ${targetHours} giờ trước và kích hoạt job quét đánh dấu QUÁ HẠN.`,
      transfers: candidates,
      jobResult,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function sendFrontendFile(res, filePath) {
  res.set({
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  const resolved = path.resolve(filePath);
  return res.sendFile(path.basename(resolved), { root: path.dirname(resolved) });
}

const frontendIndexPath = path.join(__dirname, "../../frontend/index.html");
const frontendLotsPath = path.join(__dirname, "../../frontend/lots.html");

app.get("/login", (req, res) => {
  if (fs.existsSync(frontendIndexPath)) {
    return sendFrontendFile(res, frontendIndexPath);
  }
  return res.redirect("http://localhost:8080/index.html");
});

const frontendFarmsPath = path.join(__dirname, "../../frontend/farms.html");

app.get("/farms", requireAuth, (req, res) => {
  if (fs.existsSync(frontendFarmsPath)) {
    return sendFrontendFile(res, frontendFarmsPath);
  }
  return res.redirect("http://localhost:8080/farms.html");
});

app.get("/lots", requireAuth, (req, res) => {
  if (fs.existsSync(frontendLotsPath)) {
    return sendFrontendFile(res, frontendLotsPath);
  }
  return res.redirect("http://localhost:8080/lots.html");
});

const frontendProductsPath = path.join(__dirname, "../../frontend/products.html");
const frontendHarvestPath = path.join(__dirname, "../../frontend/harvest.html");

app.get("/products", requireAuth, (req, res) => {
  if (fs.existsSync(frontendProductsPath)) {
    return sendFrontendFile(res, frontendProductsPath);
  }
  return res.redirect("http://localhost:8080/products.html");
});

app.get("/harvest", requireAuth, (req, res) => {
  if (fs.existsSync(frontendHarvestPath)) {
    return sendFrontendFile(res, frontendHarvestPath);
  }
  return res.redirect("http://localhost:8080/harvest.html");
});

const frontendLotDetailPath = path.join(__dirname, "../../frontend/lot-detail.html");

app.get(["/lot-detail", "/lot-detail.html"], requireAuth, (req, res) => {
  if (fs.existsSync(frontendLotDetailPath)) {
    return sendFrontendFile(res, frontendLotDetailPath);
  }
  const query = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  return res.redirect("http://localhost:8080/lot-detail.html" + query);
});

if (fs.existsSync(path.join(__dirname, "../../frontend"))) {
  app.use(
    express.static(path.join(__dirname, "../../frontend"), {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html") || filePath.endsWith(".css") || filePath.endsWith(".js")) {
          res.set({
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
          });
        }
      },
    })
  );
}

async function seedDemoOverdueTransfer() {
  const time49hAgo = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
  if (pool) {
    try {
      const checkRes = await pool.query(
        "SELECT id FROM lot_transfers WHERE lot_id = 'LOT-002' AND status = 'PENDING'"
      );
      if (checkRes.rows.length === 0) {
        await pool.query(
          `INSERT INTO lot_transfers (
            id, lot_id, from_organization_id, to_organization_id,
            status, is_overdue, notes, created_by_user_id, created_at, updated_at
          ) VALUES (
            'TR-OVERDUE-001', 'LOT-002', 'org-001', 'org-002',
            'PENDING', FALSE, 'Bàn giao mẫu chè Tân Cương sang HTX Bắc Giang (giả lập 49 giờ trước để test S-24)',
            'usr-orgadmin', NOW() - INTERVAL '49 hours', NOW() - INTERVAL '49 hours'
          ) ON CONFLICT (id) DO NOTHING`
        );
      }
    } catch {
      // Bỏ qua nếu DB chưa sẵn sàng
    }
  } else {
    if (!inMemoryTransfers.some((t) => t.lotId === "LOT-002" && t.status === "PENDING")) {
      const lot2 = inMemoryLots.find((l) => l.id === "LOT-002");
      if (lot2) lot2.organizationId = "org-001";
      inMemoryTransfers.push({
        id: "TR-OVERDUE-001",
        lotId: "LOT-002",
        fromOrganizationId: "org-001",
        fromOrganizationName: "Nông trại Thái Nguyên",
        toOrganizationId: "org-002",
        toOrganizationName: "Hợp tác xã Rau Sạch Bắc Giang",
        status: "PENDING",
        isOverdue: false,
        overdueAt: null,
        notes: "Bàn giao mẫu chè Tân Cương sang HTX Bắc Giang (giả lập 49 giờ trước để test S-24)",
        createdByUserId: "usr-001",
        createdAt: time49hAgo,
        updatedAt: time49hAgo,
      });
    }
  }
}

async function start() {
  await seedDemoUser();
  seedDemoEvents();

  if (pool) {
    try {
      const { runMigrations } = require("./migrate");
      await runMigrations("up");
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        console.error("[Migration Fatal Error] Startup aborted due to migration failure:", err.message);
        process.exit(1);
      } else {
        console.warn("[Migration Warning] Could not connect to PostgreSQL:", err.message);
        console.warn("[Fallback] Switching to standalone in-memory mode for local development.");
        pool = null;
      }
    }
  }

  await seedDemoOverdueTransfer();

  // Khởi động job rà soát bàn giao quá hạn định kỳ (S-24 / T-56)
  startTransferOverdueJob({ pool, inMemoryTransfers });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend server running at http://0.0.0.0:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  users,
  inMemoryLots,
  inMemoryFarms,
  inMemoryProducts,
  inMemoryOrgs,
  seedDemoUser,
  hashPassword,
  verifyPassword,
  getUserByEmail,
  getUserById,
  updateUserLock,
  resetUserLock,
  requirePermission,
  scopedQuery,
  scopedQueryById,
  SHARED_TABLES,
  logSecurityEvent,
  getRecentSecurityLogs,
  clearSecurityLogs,
  setDatabasePool,
  MAX_FAILED_ATTEMPTS,
  LOCK_MINUTES,
  pool,
  clearHarvestIdempotencyCache,
  harvestIdempotencyCache,
  GENESIS_HASH,
  canonicalize,
  calculateEventHash,
  createEventHashPayload,
  appendBatchEvent,
  getBatchEvents,
  verifyBatchEventChain,
  verifyBatchIntegrity,
  inMemoryBatchEvents,
  inMemoryIntegrityChecks,
  inMemoryOrganizations,
  inMemoryTransfers,
  inMemoryBatchRelations,
  seedDemoEvents,
  setAppendHookForTesting,
  markOverdueTransfers,
  startTransferOverdueJob,
};

