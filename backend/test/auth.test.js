const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app, users, seedDemoUser, MAX_FAILED_ATTEMPTS } = require("../src/server");

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("POST /api/login with valid credentials succeeds", async () => {
  const res = await request(app)
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "Đăng nhập thành công.");
  assert.equal(res.body.user.email, "user@example.com");
  assert.ok(res.headers["set-cookie"]);
});

test("POST /api/login with wrong password returns 401 generic message", async () => {
  const res = await request(app)
    .post("/api/login")
    .send({ email: "user@example.com", password: "WrongPassword" });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Email hoặc mật khẩu không đúng.");
});

test("POST /api/login with non-existent email returns 401 identical message", async () => {
  const res = await request(app)
    .post("/api/login")
    .send({ email: "nonexistent@example.com", password: "Password@123" });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Email hoặc mật khẩu không đúng.");
});

test("POST /api/login locks account after 5 failed attempts and blocks valid password on 6th attempt", async () => {
  // First 5 failed attempts must all return 401 Unauthorized
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    const res = await request(app)
      .post("/api/login")
      .send({ email: "user@example.com", password: "WrongPassword" });
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Email hoặc mật khẩu không đúng.");
  }

  // 6th attempt with CORRECT password must be locked (423)
  const lockedRes = await request(app)
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });
  assert.equal(lockedRes.status, 423);
  assert.equal(lockedRes.body.message, "Tài khoản đang bị khóa tạm thời.");
  assert.ok(lockedRes.body.retryAfterSeconds > 0);

  // 7th attempt with WRONG password must still be locked (423)
  const lockedWrongRes = await request(app)
    .post("/api/login")
    .send({ email: "user@example.com", password: "WrongPassword" });
  assert.equal(lockedWrongRes.status, 423);
  assert.equal(lockedWrongRes.body.message, "Tài khoản đang bị khóa tạm thời.");
});

test("GET /api/me returns 401 when unauthenticated and 200 when authenticated", async () => {
  const unauthRes = await request(app).get("/api/me");
  assert.equal(unauthRes.status, 401);

  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  const authRes = await agent.get("/api/me");
  assert.equal(authRes.status, 200);
  assert.equal(authRes.body.user.email, "user@example.com");
});

test("POST /api/logout destroys session", async () => {
  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  const logoutRes = await agent.post("/api/logout");
  assert.equal(logoutRes.status, 200);

  const meRes = await agent.get("/api/me");
  assert.equal(meRes.status, 401);
});

test("Argon2id: hash starts with $argon2id$ format", async () => {
  const { hashPassword } = require("../src/server");
  const hash = await hashPassword("TestPassword@123");
  assert.ok(hash.startsWith("$argon2id$"));
});

test("Lock expires: user can log in after 15 minutes lock window passes", async () => {
  // Lock user first
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await request(app)
      .post("/api/login")
      .send({ email: "user@example.com", password: "WrongPassword" });
  }

  const u = users.get("user@example.com");
  assert.ok(u.lockedUntil > Date.now());

  // Fast forward lock window (simulate 16 minutes passed)
  u.lockedUntil = Date.now() - 1000;

  // Now login with correct password should succeed
  const successRes = await request(app)
    .post("/api/login")
    .send({ email: "user@example.com", password: "Password@123" });

  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.message, "Đăng nhập thành công.");
  assert.equal(u.failedCount, 0);
  assert.equal(u.lockedUntil, null);
});
