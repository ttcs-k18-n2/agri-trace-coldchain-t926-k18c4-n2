const express = require("express");
const session = require("express-session");
const { hash, verify, Algorithm } = require("@node-rs/argon2");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { scopedQuery, scopedQueryById, SHARED_TABLES } = require("./query");
const { logSecurityEvent, getRecentSecurityLogs, clearSecurityLogs } = require("./security_logger");

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
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 60 * 60 * 1000,
    },
  })
);

// Fallback in-memory store for unit test environments without postgres
const users = new Map();
const inMemoryFarms = [
  { id: "FARM-001", name: "Thửa đồi chè La Bằng 01", area: 2.5, coordinates: "21.5645, 105.6789", organizationId: "org-001" },
  { id: "FARM-002", name: "Thửa cà chua Hùng Sơn 02", area: 1.2, coordinates: "21.5712, 105.6841", organizationId: "org-001" },
  { id: "FARM-101", name: "Thửa rau cải Yên Dũng 01", area: 3.0, coordinates: "21.2341, 106.1892", organizationId: "org-002" },
];
const inMemoryLots = [
  { id: "LOT-001", name: "Lô cà chua Thái Nguyên", status: "Đã ghi nhận", organizationId: "org-001" },
  { id: "LOT-002", name: "Lô chè Tân Cương", status: "Đã ghi nhận", organizationId: "org-001" },
  { id: "LOT-101", name: "Lô rau cải Bắc Giang", status: "Đã ghi nhận", organizationId: "org-002" },
  { id: "LOT-102", name: "Lô dưa chuột Hiệp Hòa", status: "Đã ghi nhận", organizationId: "org-002" },
];

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
    const result = await pool.query("SELECT NOW() AS now");
    return res.json({
      service: "agri-trace-backend",
      status: "ok",
      database: "connected",
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

    if (nextFailedCount >= MAX_FAILED_ATTEMPTS) {
      const lockUntil = now + LOCK_MINUTES * 60 * 1000;
      await updateUserLock(user, nextFailedCount, lockUntil);

      return res.status(423).json({
        message: "Tài khoản đang bị khóa tạm thời.",
        retryAfterSeconds: LOCK_MINUTES * 60,
      });
    }

    await updateUserLock(user, nextFailedCount, null);
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
 * Danh sách lô hàng của tổ chức hiện tại (T-12, T-13)
 */
app.get(
  "/api/organization/lots",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const isInspector = req.auth.isInspector;
    const orgId = req.auth.organizationId;

    if (pool) {
      try {
        const queryRes = await scopedQuery(pool, req.auth, "lots", {
          orderBy: "created_at DESC",
        });
        return res.status(200).json({
          organizationId: orgId,
          lots: queryRes.rows.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            organizationId: r.organization_id,
          })),
        });
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    }

    // In-memory fallback
    const filtered = isInspector
      ? inMemoryLots
      : inMemoryLots.filter((lot) => lot.organizationId === orgId);

    return res.status(200).json({
      organizationId: orgId,
      lots: filtered,
    });
  }
);

/**
 * Xem chi tiết lô hàng - chặn truy cập chéo tổ chức (T-13)
 */
app.get(
  "/api/organization/lots/:id",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]),
  async (req, res) => {
    const lotId = req.params.id;
    const isInspector = req.auth.isInspector;
    const orgId = req.auth.organizationId;

    let lot = null;

    if (pool) {
      try {
        const q = await scopedQueryById(pool, req.auth, "lots", lotId);
        if (q.isCrossTenant) {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "lots",
            resourceId: lotId,
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
          lot = {
            id: q.row.id,
            name: q.row.name,
            status: q.row.status,
            organizationId: q.row.organization_id,
          };
        }
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    } else {
      const match = inMemoryLots.find((l) => l.id === lotId);
      if (match) {
        if (!isInspector && match.organizationId !== orgId && req.auth.roleId !== "admin") {
          logSecurityEvent("CROSS_TENANT_ACCESS_DENIED", {
            userId: req.auth.userId || req.auth.id,
            userEmail: req.auth.email,
            userOrgId: req.auth.organizationId,
            userRole: req.auth.roleId,
            resourceType: "lots",
            resourceId: lotId,
            targetOrgId: match.organizationId,
            action: "READ",
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });
          return res.status(403).json({
            message: "Truy cập bị từ chối: bạn không có quyền xem dữ liệu của tổ chức khác.",
          });
        }
        lot = match;
      }
    }

    if (!lot) {
      return res.status(404).json({ message: "Không tìm thấy lô hàng." });
    }

    return res.status(200).json({
      lot,
    });
  }
);

/**
 * Thêm lô hàng - Cán bộ kiểm tra chỉ được đọc, không được ghi (T-11, T-13)
 */
app.post(
  "/api/organization/lots",
  requirePermission(["producer", "cooperative", "transporter", "distributor", "org_admin", "admin"]),
  async (req, res) => {
    const { id, name, status } = req.body;
    const orgId = req.auth.organizationId;

    if (!name) {
      return res.status(400).json({ message: "Tên lô hàng không được để trống." });
    }

    const lotId = id || `LOT-${Date.now().toString().slice(-4)}`;
    const lotStatus = status || "Đã ghi nhận";

    if (pool) {
      try {
        await pool.query(
          "INSERT INTO lots (id, name, status, organization_id) VALUES ($1, $2, $3, $4)",
          [lotId, name, lotStatus, orgId]
        );
      } catch (err) {
        return res.status(500).json({ message: err.message });
      }
    } else {
      inMemoryLots.push({
        id: lotId,
        name,
        status: lotStatus,
        organizationId: orgId,
      });
    }

    return res.status(201).json({
      message: "Tạo lô hàng thành công.",
      lot: { id: lotId, name, status: lotStatus, organizationId: orgId },
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

const frontendIndexPath = path.join(__dirname, "../../frontend/index.html");
const frontendLotsPath = path.join(__dirname, "../../frontend/lots.html");

app.get("/login", (req, res) => {
  if (fs.existsSync(frontendIndexPath)) {
    return res.sendFile(frontendIndexPath);
  }
  return res.redirect("http://localhost:8080/index.html");
});

const frontendFarmsPath = path.join(__dirname, "../../frontend/farms.html");

app.get("/farms", requireAuth, (req, res) => {
  if (fs.existsSync(frontendFarmsPath)) {
    return res.sendFile(frontendFarmsPath);
  }
  return res.redirect("http://localhost:8080/farms.html");
});

app.get("/lots", requireAuth, (req, res) => {
  if (fs.existsSync(frontendLotsPath)) {
    return res.sendFile(frontendLotsPath);
  }
  return res.redirect("http://localhost:8080/lots.html");
});

if (fs.existsSync(path.join(__dirname, "../../frontend"))) {
  app.use(express.static(path.join(__dirname, "../../frontend")));
}

async function start() {
  await seedDemoUser();

  if (pool) {
    try {
      const { runMigrations } = require("./migrate");
      await runMigrations("up");
    } catch (err) {
      console.error("[Migration Fatal Error] Startup aborted due to migration failure:", err.message);
      process.exit(1);
    }
  }

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
};
