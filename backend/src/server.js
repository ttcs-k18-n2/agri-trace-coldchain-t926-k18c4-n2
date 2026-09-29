const express = require("express");
const session = require("express-session");
const { hash, verify, Algorithm } = require("@node-rs/argon2");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const MAX_FAILED_ATTEMPTS = Number(process.env.MAX_FAILED_ATTEMPTS || 5);
const LOCK_MINUTES = Number(process.env.LOCK_MINUTES || 15);

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "s04-agri-secret-token",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 60 * 60 * 1000,
    },
  })
);

// Fallback in-memory store for unit test environments without postgres
const users = new Map();

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

function requireAuth(req, res, next) {
  if (!req.session.userId) {
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
    });
  }

  try {
    const result = await pool.query("SELECT NOW() AS now");
    return res.json({
      service: "agri-trace-backend",
      status: "ok",
      database: "connected",
      timestamp: result.rows[0].now,
    });
  } catch (error) {
    return res.status(503).json({
      service: "agri-trace-backend",
      status: "error",
      database: "disconnected",
      message: error.message,
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

app.get("/api/organization/lots", requireAuth, (req, res) => {
  const orgId = req.session.organizationId || "org-001";
  return res.status(200).json({
    organizationId: orgId,
    lots: [
      {
        id: "LOT-001",
        name: "Lô cà chua Thái Nguyên",
        status: "Đang vận chuyển",
      },
      {
        id: "LOT-002",
        name: "Lô rau cải Bắc Giang",
        status: "Đã nhập kho",
      },
    ],
  });
});

const frontendIndexPath = path.join(__dirname, "../../frontend/index.html");
const frontendLotsPath = path.join(__dirname, "../../frontend/lots.html");

app.get("/login", (req, res) => {
  if (fs.existsSync(frontendIndexPath)) {
    return res.sendFile(frontendIndexPath);
  }
  return res.redirect("http://localhost:8080/index.html");
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
      console.warn("[Migration Warning]", err.message);
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
  seedDemoUser,
  hashPassword,
  verifyPassword,
  getUserByEmail,
  getUserById,
  updateUserLock,
  resetUserLock,
  MAX_FAILED_ATTEMPTS,
  LOCK_MINUTES,
  pool,
};
