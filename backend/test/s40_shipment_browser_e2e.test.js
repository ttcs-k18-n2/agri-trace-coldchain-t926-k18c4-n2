/**
 * S-40 Browser E2E Test Suite (Isolated Mocked Coverage)
 *
 * Scenarios covered:
 * 1. Selecting multiple lots in create form and verifying selection counters/chips
 * 2. Creating a cold chain shipment attached to 1 container and multiple lots
 * 3. Viewing shipment detail with complete lot breakdown and completing the shipment
 * 4. Role restrictions: Inspector (read-only, no create/complete) vs Transporter/Admin
 * 5. 409 Conflict handling when attempting to attach a lot that is already in an active shipment
 *
 * Isolation guarantee:
 * - Runs against a dedicated in-memory HTTP server serving frontend files and mocked API endpoints
 * - Does NOT connect to or modify shared PostgreSQL database
 * - Driven in real headless Google Chrome via native Chrome DevTools Protocol (CDP)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const frontendDir = path.resolve(__dirname, "../../frontend");

// Detect Chrome / Edge executable
function findBrowserExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

class BrowserCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
            else resolve(data.result);
          }
        } catch (e) {
          console.error("CDP parse error:", e);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text} in (${expression})`);
    }
    return res.result ? res.result.value : undefined;
  }

  async waitForSelector(selector, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (exists) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  async waitForFunction(fnExpression, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await this.evaluate(fnExpression);
      if (res) return res;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for function: ${fnExpression}`);
  }

  async waitForText(selector, text, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const actual = await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent || ""`);
      if (actual.includes(text)) return actual;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for text "${text}" in selector: ${selector}`);
  }

  async click(selector) {
    await this.waitForSelector(selector);
    return this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.click();
        return true;
      })()
    `);
  }

  async type(selector, text) {
    await this.waitForSelector(selector);
    return this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async select(selector, value) {
    await this.waitForSelector(selector);
    return this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 1000));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function waitForHttpReady(url, maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error("Timeout waiting for HTTP at " + url);
}

// MIME types dictionary for static files
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

// Test Suite
test("S-40 Mocked Browser E2E Coverage (Isolated with Fixtures, Zero Shared PostgreSQL)", async (t) => {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    t.skip("No Chrome or Edge browser executable found on system. Reporting exact blocker: missing browser binary.");
    return;
  }

  // 1. In-Memory Fixtures State
  const inMemoryLots = [
    {
      id: "LOT-S40-001",
      name: "Dâu tây Mộc Châu Loại 1 (Xuất khẩu)",
      product_name: "Dâu tây Mộc Châu",
      current_quantity: 150,
      unit: "kg",
      status: "ACTIVE",
      created_at: "2026-10-15T08:00:00.000Z",
    },
    {
      id: "LOT-S40-002",
      name: "Dâu tây Mộc Châu Loại 2 (Tiêu chuẩn)",
      product_name: "Dâu tây Mộc Châu",
      current_quantity: 100,
      unit: "kg",
      status: "ACTIVE",
      created_at: "2026-10-15T08:30:00.000Z",
    },
    {
      id: "LOT-S40-003",
      name: "Mận hậu Sơn La Loại A",
      product_name: "Mận hậu Sơn La",
      current_quantity: 300,
      unit: "kg",
      status: "ACTIVE",
      created_at: "2026-10-15T09:00:00.000Z",
    },
    {
      id: "LOT-S40-004-BUSY",
      name: "Cà chua bi Mộc Châu (Đã gắn chuyến khác)",
      product_name: "Cà chua bi",
      current_quantity: 80,
      unit: "kg",
      status: "ACTIVE",
      created_at: "2026-10-15T09:30:00.000Z",
    },
  ];

  const inMemoryContainers = [
    {
      id: "CONT-COLD-01",
      name: "Thùng lạnh chuyên dụng 50L (Vắc-xin & Nông sản nhạy cảm)",
      tempMin: 2,
      tempMax: 8,
      capacityLiters: 50,
      sensorModel: "IoT DHT22 Pro",
      status: "READY",
    },
    {
      id: "CONT-COLD-02",
      name: "Thùng lạnh siêu tốc 120L (Rau củ quả tươi cao cấp)",
      tempMin: 0,
      tempMax: 4,
      capacityLiters: 120,
      sensorModel: "PT100 Industrial",
      status: "READY",
    },
  ];

  const inMemoryShipments = [];

  // 2. Start Isolated Mock HTTP Server
  let activeRole = "transporter";

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // Helper to send JSON
    const sendJson = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(data));
    };

    // Helper to parse JSON body
    const parseBody = () => {
      return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });
    };

    // Determine current user role from query, header, or state
    const requestedRole = parsedUrl.searchParams.get("role") || req.headers["x-role"] || activeRole;

    // Route: /api/me (Auth Profile)
    if (pathname === "/api/me") {
      if (requestedRole === "inspector") {
        return sendJson(200, {
          user: {
            id: "user-insp-01",
            email: "inspector@example.com",
            fullName: "Nguyễn Kiểm Định",
            roleId: "inspector",
            organizationId: "org-inspector",
            organizationName: "Chi cục Quản lý Chất lượng Nông sản",
            isAdmin: false,
            isInspector: true,
          },
        });
      }
      return sendJson(200, {
        user: {
          id: "user-trans-01",
          email: "transporter@example.com",
          fullName: "Nguyễn Văn Lái (Vận chuyển)",
          roleId: "transporter",
          organizationId: "org-trans-01",
          organizationName: "Hợp tác xã Vận tải Lạnh Mộc Châu",
          isAdmin: false,
          isInspector: false,
        },
      });
    }

    // Route: /api/cold-containers
    if (pathname === "/api/cold-containers") {
      return sendJson(200, { success: true, containers: inMemoryContainers });
    }

    // Route: /api/organization/lots
    if (pathname === "/api/organization/lots") {
      return sendJson(200, { success: true, lots: inMemoryLots });
    }

    // Route: /api/shipments (POST - Create)
    if (pathname === "/api/shipments" && req.method === "POST") {
      if (requestedRole === "inspector") {
        return sendJson(403, {
          error: "FORBIDDEN",
          message: "Tài khoản Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, không được phép tạo chuyến vận chuyển.",
        });
      }

      const body = await parseBody();
      const lotIds = body.lotIds || [];

      // Check conflict if lot is already attached to an active shipment
      if (lotIds.includes("LOT-S40-004-BUSY")) {
        return sendJson(409, {
          error: "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
          message: "Lô hàng LOT-S40-004-BUSY hiện đang trong chuyến vận chuyển khác (shp-active-999).",
        });
      }

      const shipmentId = `shp-${Date.now()}`;
      const attachedLots = inMemoryLots
        .filter((l) => lotIds.includes(l.id))
        .map((l) => ({
          lotId: l.id,
          lotName: l.name,
          quantity: l.current_quantity,
          unit: l.unit,
          product_name: l.product_name,
        }));

      const newShipment = {
        id: shipmentId,
        code: body.code || shipmentId,
        containerId: body.containerId || body.coldBoxId,
        coldBoxId: body.coldBoxId || body.containerId,
        status: "IN_TRANSIT",
        origin: body.origin || body.originLocationId,
        originLocationId: body.originLocationId || body.origin,
        destination: body.destination || body.destinationLocationId,
        destinationLocationId: body.destinationLocationId || body.destination,
        departureTime: body.departureTime,
        startedAt: body.departureTime,
        completedAt: null,
        driverName: body.driverName || "Chưa phân công",
        driverPhone: body.driverPhone || "",
        vehiclePlate: body.vehiclePlate || "N/A",
        notes: body.notes || "",
        lotIds,
        lots: attachedLots,
        createdAt: new Date().toISOString(),
      };

      inMemoryShipments.unshift(newShipment);
      return sendJson(201, { success: true, shipment: newShipment });
    }

    // Route: /api/shipments (GET - List)
    if (pathname === "/api/shipments" && req.method === "GET") {
      return sendJson(200, {
        success: true,
        data: inMemoryShipments,
        shipments: inMemoryShipments,
        total: inMemoryShipments.length,
      });
    }

    // Route: /api/shipments/:id/complete (POST - Complete)
    const completeMatch = pathname.match(/^\/api\/shipments\/([^/]+)\/complete$/);
    if (completeMatch && req.method === "POST") {
      if (requestedRole === "inspector") {
        return sendJson(403, {
          error: "FORBIDDEN",
          message: "Tài khoản Cán bộ kiểm tra (Inspector) không có quyền kết thúc chuyến vận chuyển.",
        });
      }

      const shipId = completeMatch[1];
      const target = inMemoryShipments.find((s) => s.id === shipId || s.code === shipId);
      if (!target) {
        return sendJson(404, { error: "NOT_FOUND", message: "Không tìm thấy chuyến vận chuyển." });
      }

      target.status = "COMPLETED";
      target.completedAt = new Date().toISOString();
      return sendJson(200, { success: true, shipment: target });
    }

    // Route: /api/shipments/:id (GET - Detail)
    const detailMatch = pathname.match(/^\/api\/shipments\/([^/]+)$/);
    if (detailMatch && req.method === "GET") {
      const shipId = detailMatch[1];
      const target = inMemoryShipments.find((s) => s.id === shipId || s.code === shipId);
      if (!target) {
        return sendJson(404, { error: "NOT_FOUND", message: "Không tìm thấy chuyến vận chuyển." });
      }
      return sendJson(200, { success: true, shipment: target, data: target });
    }

    // Static files serving from frontendDir
    let filePath = path.join(frontendDir, pathname === "/" ? "shipments.html" : pathname);
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + ".html")) {
      filePath += ".html";
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // 3. Launch Headless Google Chrome
  const cdpPort = 9222 + Math.floor(Math.random() * 500);
  const tmpProfile = path.join(os.tmpdir(), "s40-e2e-chrome-" + Date.now());

  const chromeProc = spawn(browserPath, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-gpu",
    `--user-data-dir=${tmpProfile}`,
    `${baseUrl}/shipments.html`,
  ]);

  let client = null;

  try {
    // Wait for Chrome CDP readiness
    await waitForHttpReady(`http://127.0.0.1:${cdpPort}/json/version`, 50);
    const tabs = await waitForHttpReady(`http://127.0.0.1:${cdpPort}/json/list`, 30);
    const pageTab = tabs.find((t) => t.type === "page");
    assert.ok(pageTab, "Chrome page tab must be available");

    client = new BrowserCDP(pageTab.webSocketDebuggerUrl);
    await client.connect();

    // =========================================================================
    // SCENARIO 1: Transporter Flow - Multi-Lot Selection & Shipment Creation
    // =========================================================================
    await t.test("Scenario 1: Multi-Lot Selection & Creation in Real Headless Browser", async () => {
      activeRole = "transporter";
      await client.navigate(`${baseUrl}/shipments.html`);

      // 1.1 Verify page title and header
      await client.waitForSelector("#btnOpenCreateModal");
      const title = await client.evaluate("document.title");
      assert.match(title, /Quản lý chuyến vận chuyển lạnh/);

      // 1.2 Open Create Shipment Modal
      await client.click("#btnOpenCreateModal");
      await client.waitForSelector("#modalCreateShipment");
      const modalVisible = await client.evaluate('document.getElementById("modalCreateShipment").style.display');
      assert.equal(modalVisible, "flex");

      // 1.3 Select Container CONT-COLD-01
      await client.waitForSelector('#select-container option[value="CONT-COLD-01"]');
      await client.select("#select-container", "CONT-COLD-01");
      const containerSpecText = await client.waitForText("#container-info-box", "50 Lít");
      assert.match(containerSpecText, /2°C ~ 8°C/);

      // 1.4 Multi-Lot Selection in Available Lots Table
      await client.waitForSelector('.lot-checkbox[data-id="LOT-S40-001"]');
      await client.waitForSelector('.lot-checkbox[data-id="LOT-S40-002"]');

      // Click row for LOT-S40-001
      await client.click('.lot-checkbox[data-id="LOT-S40-001"]');
      // Click row for LOT-S40-002
      await client.click('.lot-checkbox[data-id="LOT-S40-002"]');

      // Verify Selection Summary: 2 lots, 250 kg (150 + 100)
      const selectedCount = await client.evaluate('document.getElementById("selectedLotsCount").textContent');
      const selectedWeight = await client.evaluate('document.getElementById("selectedLotsWeight").textContent');
      assert.equal(selectedCount, "2");
      assert.equal(selectedWeight, "250");

      // Verify Chips contain both selected lots
      const chipsText = await client.evaluate('document.getElementById("selectedLotsChips").textContent');
      assert.match(chipsText, /LOT-S40-001/);
      assert.match(chipsText, /LOT-S40-002/);

      // 1.5 Fill Route Information
      await client.type("#input-shipment-code", "SHP-COLD-MC-001");
      await client.type("#input-origin", "Kho Lạnh Hợp Tác Xã Mộc Châu");
      await client.type("#input-destination", "Trung Tâm Phân Phối Hà Nội");
      await client.type("#input-driver", "Tài Xế Hoàng");
      await client.type("#input-vehicle", "29C-123.45");

      // 1.6 Submit Form
      await client.click("#btnSubmitShipment");

      // Verify Modal closes
      await client.waitForFunction('document.getElementById("modalCreateShipment").style.display === "none"');
      const modalClosed = await client.evaluate('document.getElementById("modalCreateShipment").style.display');
      assert.equal(modalClosed, "none");

      // Verify Shipment card is rendered in the grid
      await client.waitForSelector('.shipment-card[data-id]');
      const cardHtml = await client.evaluate('document.querySelector(".shipment-card").innerHTML');
      assert.match(cardHtml, /SHP-COLD-MC-001/);
      assert.match(cardHtml, /CONT-COLD-01/);
      assert.match(cardHtml, /Đang vận chuyển/);
      assert.match(cardHtml, /LOT-S40-001/);
      assert.match(cardHtml, /LOT-S40-002/);
      assert.match(cardHtml, /Kho Lạnh Hợp Tác Xã Mộc Châu/);
      assert.match(cardHtml, /Trung Tâm Phân Phối Hà Nội/);

      // Verify KPIs updated
      const kpiTotal = await client.evaluate('document.getElementById("kpiTotal").textContent');
      const kpiRunning = await client.evaluate('document.getElementById("kpiRunning").textContent');
      assert.equal(kpiTotal, "1");
      assert.equal(kpiRunning, "1");
    });

    // =========================================================================
    // SCENARIO 2: View Detail Modal & Complete Shipment
    // =========================================================================
    await t.test("Scenario 2: View Multi-Lot Detail and Complete Shipment in Browser", async () => {
      // 2.1 Click "Chi tiết chuyến"
      await client.click(".btn-view-detail");
      await client.waitForSelector("#modalShipmentDetail");
      const detailDisplay = await client.evaluate('document.getElementById("modalShipmentDetail").style.display');
      assert.equal(detailDisplay, "flex");

      // 2.2 Verify Detail Content Area renders Container, Route, and Both Lots
      const detailAreaText = await client.evaluate('document.getElementById("detailContentArea").textContent');
      assert.match(detailAreaText, /SHP-COLD-MC-001/);
      assert.match(detailAreaText, /CONT-COLD-01/);
      assert.match(detailAreaText, /LOT-S40-001/);
      assert.match(detailAreaText, /LOT-S40-002/);
      assert.match(detailAreaText, /Dâu tây Mộc Châu/);
      assert.match(detailAreaText, /150/);
      assert.match(detailAreaText, /100/);

      // 2.3 Transporter clicks "Kết thúc chuyến vận chuyển"
      // Mock window.confirm to return true
      await client.evaluate("window.confirm = () => true");
      await client.click("#btnDetailCompleteAction");

      // 2.4 Verify Shipment transitions to COMPLETED
      await client.waitForText(".shipment-card", "Đã kết thúc");
      const updatedCardHtml = await client.evaluate('document.querySelector(".shipment-card").innerHTML');
      assert.match(updatedCardHtml, /Đã kết thúc/);
      assert.match(updatedCardHtml, /Đã lưu trữ an toàn/);
      assert.doesNotMatch(updatedCardHtml, /btn-complete-shipment/);

      // Verify KPI Completed updated
      const kpiCompleted = await client.evaluate('document.getElementById("kpiCompleted").textContent');
      assert.equal(kpiCompleted, "1");
    });

    // =========================================================================
    // SCENARIO 3: Role Restrictions (Inspector Read-Only UI Guards)
    // =========================================================================
    await t.test("Scenario 3: Role Restrictions (Inspector Read-Only Access Guards)", async () => {
      // Switch active user to inspector
      activeRole = "inspector";
      await client.navigate(`${baseUrl}/shipments.html?role=inspector`);

      // 3.1 Verify Inspector Email displayed in header
      await client.waitForSelector("#userEmail");
      const userEmail = await client.evaluate('document.getElementById("userEmail").textContent');
      assert.equal(userEmail, "inspector@example.com");

      // 3.2 "Mở chuyến mới" button MUST be hidden for Inspector
      const createBtnDisplay = await client.evaluate('document.getElementById("btnOpenCreateModal").style.display');
      assert.equal(createBtnDisplay, "none");

      // 3.3 Complete button in shipment cards MUST NOT be shown for Inspector
      const cardFooterHtml = await client.evaluate('document.querySelector(".shipment-card-footer")?.innerHTML || ""');
      assert.doesNotMatch(cardFooterHtml, /btn-complete-shipment/);

      // 3.4 Open detail modal as Inspector: Action button to complete MUST NOT be rendered
      await client.click(".btn-view-detail");
      await client.waitForSelector("#modalShipmentDetail");
      const detailCompleteBtn = await client.evaluate('Boolean(document.getElementById("btnDetailCompleteAction"))');
      assert.equal(detailCompleteBtn, false, "Inspector must not see the complete button in detail modal");

      // Close modal
      await client.click("#btnCloseDetailModal");

      // 3.5 Verify Direct API Adapter Call with Inspector role receives 403 Forbidden
      const directCreateAttempt = await client.evaluate(`
        window.ShipmentAdapter.createShipment({
          shipmentCode: "SHP-HACK-01",
          containerId: "CONT-COLD-01",
          lotIds: ["LOT-S40-001"],
          origin: "A",
          destination: "B",
          departureTime: new Date().toISOString()
        })
      `);
      assert.equal(directCreateAttempt.success, false);
      assert.equal(directCreateAttempt.isForbidden, true);
    });

    // =========================================================================
    // SCENARIO 4: 409 Conflict Protection in Browser UI
    // =========================================================================
    await t.test("Scenario 4: 409 Conflict Protection on Active Lot in Browser UI", async () => {
      activeRole = "transporter";
      await client.navigate(`${baseUrl}/shipments.html`);

      // Open create modal
      await client.click("#btnOpenCreateModal");
      await client.waitForSelector('#select-container option[value="CONT-COLD-01"]');
      await client.select("#select-container", "CONT-COLD-01");

      // Select busy lot
      await client.waitForSelector('.lot-checkbox[data-id="LOT-S40-004-BUSY"]');
      await client.click('.lot-checkbox[data-id="LOT-S40-004-BUSY"]');

      await client.type("#input-shipment-code", "SHP-CONFLICT-TEST");
      await client.type("#input-origin", "Kho A");
      await client.type("#input-destination", "Kho B");

      // Submit
      await client.click("#btnSubmitShipment");

      // Verify Alert Banner displays conflict error message
      await client.waitForSelector("#alertBanner");
      const alertText = await client.evaluate('document.getElementById("alertBanner").textContent');
      assert.match(alertText, /chuyến vận chuyển khác/);
    });
  } finally {
    if (client) await client.close();
    chromeProc.kill();
    server.close();
  }
});
