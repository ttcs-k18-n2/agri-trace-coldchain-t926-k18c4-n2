const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../../frontend");
const { hasPermission, APP_PERMISSIONS, formatRole } = require("../../frontend/app-shell.js");

test("Frontend Permissions: App Shell exposes permission matrix and hasPermission helper", () => {
  assert.ok(APP_PERMISSIONS);
  assert.equal(typeof hasPermission, "function");

  // Farm write permissions
  assert.equal(hasPermission("producer", "farm.write"), true);
  assert.equal(hasPermission("cooperative", "farm.write"), true);
  assert.equal(hasPermission("org_admin", "farm.write"), true);
  assert.equal(hasPermission("admin", "farm.write"), true);
  assert.equal(hasPermission("transporter", "farm.write"), false);
  assert.equal(hasPermission("distributor", "farm.write"), false);
  assert.equal(hasPermission("inspector", "farm.write"), false);

  // Harvest create permissions
  assert.equal(hasPermission("producer", "harvest.create"), true);
  assert.equal(hasPermission("cooperative", "harvest.create"), true);
  assert.equal(hasPermission("org_admin", "harvest.create"), true);
  assert.equal(hasPermission("admin", "harvest.create"), true);
  assert.equal(hasPermission("transporter", "harvest.create"), false);
  assert.equal(hasPermission("distributor", "harvest.create"), false);
  assert.equal(hasPermission("inspector", "harvest.create"), false);

  // Product write permissions (Admin only)
  assert.equal(hasPermission("admin", "product.write"), true);
  assert.equal(hasPermission("org_admin", "product.write"), false);
  assert.equal(hasPermission("producer", "product.write"), false);
  assert.equal(hasPermission("inspector", "product.write"), false);

  // Global read permissions
  assert.equal(hasPermission("inspector", "global.read"), true);
  assert.equal(hasPermission("admin", "global.read"), true);
  assert.equal(hasPermission("producer", "global.read"), false);

  // Integrity check permissions (Inspector and Admin only - S-12)
  assert.equal(hasPermission("inspector", "integrity.check"), true);
  assert.equal(hasPermission("admin", "integrity.check"), true);
  assert.equal(hasPermission("producer", "integrity.check"), false);
  assert.equal(hasPermission("cooperative", "integrity.check"), false);
  assert.equal(hasPermission("transporter", "integrity.check"), false);
});

test("Frontend Permissions: Role labels include org_admin across all formatRole implementations", () => {
  assert.equal(formatRole("org_admin"), "Quản trị tổ chức");
  assert.equal(formatRole("admin"), "Quản trị viên");
  assert.equal(formatRole("producer"), "Nông dân / Sản xuất");
});

test("Frontend Permissions: farms.html guards write actions against Transporter, Distributor, and Inspector", () => {
  const html = fs.readFileSync(path.join(frontendDir, "farms.html"), "utf8");
  assert.match(html, /hasPermission\([^)]*farm\.write/);
  assert.match(html, /canWriteFarm/);
  assert.match(html, /\(Chỉ xem\)/);
});

test("Frontend Permissions: products.html only exposes management controls to product.write authorized role (Admin)", () => {
  const html = fs.readFileSync(path.join(frontendDir, "products.html"), "utf8");
  assert.match(html, /hasPermission\([^)]*product\.write/);
  assert.match(html, /admin-actions/);
});

test("Frontend Permissions: harvest.html and lots.html guard harvest creation using harvest.create permission", () => {
  const harvestHtml = fs.readFileSync(path.join(frontendDir, "harvest.html"), "utf8");
  assert.match(harvestHtml, /hasPermission\([^)]*harvest\.create/);

  const lotsHtml = fs.readFileSync(path.join(frontendDir, "lots.html"), "utf8");
  assert.match(lotsHtml, /hasPermission\([^)]*harvest\.create/);
});

test("Frontend Permissions: index.html contains all 7 demo accounts and fixes Inspector org to org-inspector without role dropdown", () => {
  const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
  
  // All 7 test accounts present
  assert.match(html, /admin@example\.com/);
  assert.match(html, /orgadmin@example\.com/);
  assert.match(html, /user@example\.com/);
  assert.match(html, /user2@example\.com/);
  assert.match(html, /transporter@example\.com/);
  assert.match(html, /distributor@example\.com/);
  assert.match(html, /inspector@example\.com/);

  // Inspector org is correctly org-inspector
  assert.match(html, /inspector@example\.com[\s\S]*?org-inspector/);
  assert.doesNotMatch(html, /inspector@example\.com[\s\S]*?org-001/);

  // Security: No role dropdown selection element in form
  assert.doesNotMatch(html, /<select[^>]*name=["']role["']/);
});

test("Frontend Resilience: Dockerfile copies app-shell.js into nginx web root", () => {
  const dockerfile = fs.readFileSync(path.join(frontendDir, "Dockerfile"), "utf8");
  assert.match(dockerfile, /COPY\s+app-shell\.js\s+\/usr\/share\/nginx\/html\/app-shell\.js/);
});

test("Frontend Resilience: app-shell.js exports handleLogout and setupLogout", () => {
  const appShell = require("../../frontend/app-shell.js");
  assert.equal(typeof appShell.handleLogout, "function");
  assert.equal(typeof appShell.setupLogout, "function");
});

test("Frontend Resilience: all HTML pages have fail-safe logout button", () => {
  const pages = ["lots.html", "farms.html", "products.html", "harvest.html"];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(frontendDir, page), "utf8");
    assert.match(html, /id=["']logout["']/);
    assert.match(html, /handleLogout/);
  }
});

test("Frontend Role Scoping: NAV_PERMISSIONS strictly filters nav items per role", () => {
  const { NAV_PERMISSIONS } = require("../../frontend/app-shell.js");
  assert.ok(NAV_PERMISSIONS);

  // Transporter & Distributor only see Lots and Products
  assert.equal(NAV_PERMISSIONS.navLots.includes("transporter"), true);
  assert.equal(NAV_PERMISSIONS.navProducts.includes("transporter"), true);
  assert.equal(NAV_PERMISSIONS.navFarms.includes("transporter"), false);
  assert.equal(NAV_PERMISSIONS.navHarvest.includes("transporter"), false);

  assert.equal(NAV_PERMISSIONS.navLots.includes("distributor"), true);
  assert.equal(NAV_PERMISSIONS.navProducts.includes("distributor"), true);
  assert.equal(NAV_PERMISSIONS.navFarms.includes("distributor"), false);
  assert.equal(NAV_PERMISSIONS.navHarvest.includes("distributor"), false);

  // Inspector can view Lots, Farms, Products, but NOT Harvest
  assert.equal(NAV_PERMISSIONS.navLots.includes("inspector"), true);
  assert.equal(NAV_PERMISSIONS.navFarms.includes("inspector"), true);
  assert.equal(NAV_PERMISSIONS.navProducts.includes("inspector"), true);
  assert.equal(NAV_PERMISSIONS.navHarvest.includes("inspector"), false);

  // Producer and Cooperative see all 4
  assert.equal(NAV_PERMISSIONS.navLots.includes("producer"), true);
  assert.equal(NAV_PERMISSIONS.navFarms.includes("producer"), true);
  assert.equal(NAV_PERMISSIONS.navProducts.includes("producer"), true);
  assert.equal(NAV_PERMISSIONS.navHarvest.includes("producer"), true);
});

test("Frontend Role Scoping: farms.html has farmFormCard and completely hides form for non-writers", () => {
  const html = fs.readFileSync(path.join(frontendDir, "farms.html"), "utf8");
  assert.match(html, /id=["']farmFormCard["']/);
  assert.match(html, /formCard\.style\.display\s*=\s*["']none["']/);
});

test("Frontend Integrity Page: integrity.html correctly parses /api/me { user } structure and uses single atomic integrity API", () => {
  const html = fs.readFileSync(path.join(frontendDir, "integrity.html"), "utf8");

  // Does not directly assign user = await meRes.json() without accessing .user
  assert.doesNotMatch(html, /const\s+user\s*=\s*await\s+meRes\.json\(\)\s*;\s*const\s+allowedRoles/);

  // Correctly unpacks user from response or data.user
  assert.match(html, /data\.user|\{\s*user\s*\}|user\s*=\s*data\.user/);

  // Calls single atomic /integrity API endpoint
  assert.match(html, /\/api\/lots\/[^`"']*\/integrity/);

  // Does not perform redundant separate fetch to /events in performCheck
  assert.doesNotMatch(html, /fetch\([^)]*\/events[^)]*\)/);
});

