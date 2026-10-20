const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../../frontend");
const adapterPath = path.join(frontendDir, "shipment-adapter.js");
const appShellPath = path.join(frontendDir, "app-shell.js");

const ShipmentAdapter = require(adapterPath);
const appShell = require(appShellPath);

test("S-40 Adapter: Exports all required contract and operation methods", () => {
  assert.equal(typeof ShipmentAdapter.listShipments, "function");
  assert.equal(typeof ShipmentAdapter.getShipmentDetail, "function");
  assert.equal(typeof ShipmentAdapter.createShipment, "function");
  assert.equal(typeof ShipmentAdapter.completeShipment, "function");
  assert.equal(typeof ShipmentAdapter.validateShipmentPayload, "function");
  assert.equal(typeof ShipmentAdapter.fetchAvailableLots, "function");
  assert.equal(typeof ShipmentAdapter.fetchColdContainers, "function");
  assert.equal(typeof ShipmentAdapter.formatShipmentStatus, "function");
  assert.equal(typeof ShipmentAdapter.checkContractAvailability, "function");
  assert.equal(typeof ShipmentAdapter.getContractStatus, "function");
  assert.equal(ShipmentAdapter.CONTRACT_DOC_PATH, "docs/S40_API_CONTRACT.md");
});

test("S-40 Adapter Validation: Rejects missing or invalid fields strictly", () => {
  // Empty payload
  const emptyRes = ShipmentAdapter.validateShipmentPayload({});
  assert.equal(emptyRes.isValid, false);
  assert.ok(emptyRes.errors.shipmentCode);
  assert.ok(emptyRes.errors.containerId);
  assert.ok(emptyRes.errors.lotIds);
  assert.ok(emptyRes.errors.origin);
  assert.ok(emptyRes.errors.destination);
  assert.ok(emptyRes.errors.departureTime);

  // Invalid shipment code (too short or invalid chars)
  const codeRes = ShipmentAdapter.validateShipmentPayload({
    shipmentCode: "A!",
    containerId: "CONT-01",
    lotIds: ["LOT-001"],
    origin: "Kho A",
    destination: "Kho B",
    departureTime: new Date().toISOString(),
  });
  assert.equal(codeRes.isValid, false);
  assert.ok(codeRes.errors.shipmentCode);

  // Missing container
  const noContainerRes = ShipmentAdapter.validateShipmentPayload({
    shipmentCode: "SHP-202610-001",
    containerId: "",
    lotIds: ["LOT-001"],
    origin: "Kho A",
    destination: "Kho B",
    departureTime: new Date().toISOString(),
  });
  assert.equal(noContainerRes.isValid, false);
  assert.ok(noContainerRes.errors.containerId);

  // Empty lotIds (multi-lot requirement: at least 1 lot)
  const noLotsRes = ShipmentAdapter.validateShipmentPayload({
    shipmentCode: "SHP-202610-001",
    containerId: "CONT-01",
    lotIds: [],
    origin: "Kho A",
    destination: "Kho B",
    departureTime: new Date().toISOString(),
  });
  assert.equal(noLotsRes.isValid, false);
  assert.ok(noLotsRes.errors.lotIds);

  // Valid payload with 1 container and multiple lots
  const validRes = ShipmentAdapter.validateShipmentPayload({
    shipmentCode: "SHP-202610-001",
    containerId: "CONT-COLD-01",
    lotIds: ["LOT-001", "LOT-002", "LOT-003"],
    origin: "Kho lạnh Hợp tác xã Mộc Châu",
    destination: "Trung tâm phân phối Hà Nội",
    departureTime: "2026-10-16T18:00:00.000Z",
  });
  assert.equal(validRes.isValid, true);
  assert.equal(Object.keys(validRes.errors).length, 0);
});

test("S-40 Adapter: Correctly formats shipment statuses and classes", () => {
  const running = ShipmentAdapter.formatShipmentStatus("IN_TRANSIT");
  assert.equal(running.label, "Đang vận chuyển");
  assert.equal(running.badgeClass, "badge-status-running");

  const completed = ShipmentAdapter.formatShipmentStatus("COMPLETED");
  assert.equal(completed.label, "Đã kết thúc");
  assert.equal(completed.badgeClass, "badge-status-completed");

  const scheduled = ShipmentAdapter.formatShipmentStatus("SCHEDULED");
  assert.equal(scheduled.label, "Chờ khởi hành");
  assert.equal(scheduled.badgeClass, "badge-status-scheduled");

  const alert = ShipmentAdapter.formatShipmentStatus("ALERT");
  assert.equal(alert.label, "Cảnh báo nhiệt độ");
  assert.equal(alert.badgeClass, "badge-status-alert");
});

test("S-40 AppShell Permissions: Includes shipment permissions and navigation", () => {
  const { APP_PERMISSIONS, NAV_PERMISSIONS } = appShell;

  assert.ok(APP_PERMISSIONS["shipment.create"]);
  assert.ok(APP_PERMISSIONS["shipment.create"].includes("transporter"));
  assert.ok(APP_PERMISSIONS["shipment.create"].includes("cooperative"));
  assert.ok(APP_PERMISSIONS["shipment.create"].includes("admin"));

  assert.ok(NAV_PERMISSIONS.navShipments);
  assert.ok(NAV_PERMISSIONS.navShipments.includes("transporter"));
  assert.ok(NAV_PERMISSIONS.navShipments.includes("cooperative"));
  assert.ok(NAV_PERMISSIONS.navShipments.includes("inspector"));
  assert.ok(NAV_PERMISSIONS.navShipments.includes("admin"));
});

test("S-40 UI: shipments.html contains full layout, form, and detail modal", () => {
  const html = fs.readFileSync(path.join(frontendDir, "shipments.html"), "utf8");

  // Title and Header
  assert.match(html, /Quản lý chuyến vận chuyển lạnh/);
  assert.match(html, /id=["']btnOpenCreateModal["']/);
  assert.match(html, /id=["']btnRefreshShipments["']/);

  // Status Banner & KPI Cards
  assert.match(html, /id=["']contractNoticeBanner["']/);
  assert.match(html, /id=["']kpiTotal["']/);
  assert.match(html, /id=["']kpiRunning["']/);
  assert.match(html, /id=["']kpiCompleted["']/);
  assert.match(html, /id=["']kpiContainers["']/);

  // Toolbar & Search
  assert.match(html, /id=["']searchShipmentsInput["']/);
  assert.match(html, /data-filter=["']IN_TRANSIT["']/);
  assert.match(html, /data-filter=["']COMPLETED["']/);

  // Form with one container and multi-lot selection
  assert.match(html, /id=["']input-shipment-code["']/);
  assert.match(html, /id=["']select-container["']/);
  assert.match(html, /id=["']lotsTableBody["']/);
  assert.match(html, /id=["']selectedLotsCount["']/);
  assert.match(html, /id=["']selectedLotsWeight["']/);
  assert.match(html, /id=["']selectedLotsChips["']/);
  assert.match(html, /id=["']btnSubmitShipment["']/);

  // Detail Modal
  assert.match(html, /id=["']modalShipmentDetail["']/);
  assert.match(html, /id=["']detailContentArea["']/);

  // Scripts loaded
  assert.match(html, /src=["'][^"']*app-shell\.js[^"']*["']/);
  assert.match(html, /src=["'][^"']*shipment-adapter\.js[^"']*["']/);
  assert.match(html, /src=["'][^"']*shipments\.js[^"']*["']/);
});

test("S-40 Modal: create-shipment form scrolls without hiding submit actions", () => {
  const html = fs.readFileSync(path.join(frontendDir, "shipments.html"), "utf8");
  assert.match(html, /#modalCreateShipment \\.modal-card\\s*\\{[^}]*height:\\s*min\\(90dvh/);
  assert.match(html, /#formCreateShipment\\s*\\{[^}]*display:\\s*flex;[^}]*flex-direction:\\s*column;[^}]*min-height:\\s*0;[^}]*overflow:\\s*hidden;/);
  assert.match(html, /#formCreateShipment \\.modal-body\\s*\\{[^}]*min-height:\\s*0;[^}]*overflow-y:\\s*auto;/);
  assert.match(html, /#modalCreateShipment \\.modal-footer\\s*\\{[^}]*flex:\\s*0 0 auto;/);
  assert.match(html, /id="formCreateShipment"[\\s\\S]*class="modal-body"[\\s\\S]*class="modal-footer"[\\s\\S]*id="btnSubmitShipment"/);
});

test("S-40 Navigation Integration: All major authenticated pages link to /shipments.html", () => {
  const pages = ["lots.html", "farms.html", "products.html", "harvest.html", "integrity.html", "audit-logs.html", "lot-detail.html"];

  for (const page of pages) {
    const html = fs.readFileSync(path.join(frontendDir, page), "utf8");
    assert.match(
      html,
      /href=["']\/shipments\.html["'][^>]*id=["']navShipments["']|id=["']navShipments["'][^>]*href=["']\/shipments\.html["']/,
      `${page} is missing navigation link to /shipments.html with id="navShipments"`
    );
  }
});

test("S-40 Docker & Nginx Deployment: Dockerfile and nginx.conf serve shipments page", () => {
  const dockerfile = fs.readFileSync(path.join(frontendDir, "Dockerfile"), "utf8");
  assert.match(dockerfile, /COPY\s+shipments\.html\s+\/usr\/share\/nginx\/html\/shipments\.html/);
  assert.match(dockerfile, /COPY\s+shipment-adapter\.js\s+\/usr\/share\/nginx\/html\/shipment-adapter\.js/);
  assert.match(dockerfile, /COPY\s+shipments\.js\s+\/usr\/share\/nginx\/html\/shipments\.js/);

  const nginxConf = fs.readFileSync(path.join(frontendDir, "nginx.conf"), "utf8");
  assert.match(nginxConf, /try_files\s+\$uri\s+\$uri\.html\s+\$uri\/\s+\/index\.html/);
});

test("S-40 Adapter & Backend Compatibility (bed56d1 Harmonization): Normalizes coldBoxId, location aliases, and lot IDs", () => {
  const backendRawShipment = {
    id: "shp-abc12345",
    coldBoxId: "CBX-001",
    status: "IN_TRANSIT",
    originLocationId: "LOC-WH-TN-01",
    destinationLocationId: "LOC-HUB-HN-01",
    vehiclePlate: "29C-888.88",
    driverName: "Nguyễn Văn Lái",
    lotIds: ["LOT-001", "LOT-002"],
    lots: [{ lotId: "LOT-001" }, { lotId: "LOT-002" }],
    started_at: "2026-10-16T12:00:00.000Z",
  };

  const normalized = ShipmentAdapter.normalizeShipment(backendRawShipment);
  assert.equal(normalized.id, "shp-abc12345");
  assert.equal(normalized.containerId, "CBX-001");
  assert.equal(normalized.coldBoxId, "CBX-001");
  assert.equal(normalized.origin, "LOC-WH-TN-01");
  assert.equal(normalized.originLocationId, "LOC-WH-TN-01");
  assert.equal(normalized.destination, "LOC-HUB-HN-01");
  assert.equal(normalized.destinationLocationId, "LOC-HUB-HN-01");
  assert.equal(normalized.status, "IN_TRANSIT");
  assert.equal(normalized.driverName, "Nguyễn Văn Lái");
  assert.deepEqual(normalized.lotIds, ["LOT-001", "LOT-002"]);
  assert.equal(normalized.departureTime, "2026-10-16T12:00:00.000Z");
});

test("S-40 Backend Route: GET /api/cold-containers returns valid container list", async () => {
  const { app, seedDemoUser } = require("../src/server");
  const request = require("supertest");
  await seedDemoUser();

  const agent = request.agent(app);
  await agent.post("/api/login").send({ email: "user@example.com", password: "Password@123" });

  const res = await agent.get("/api/cold-containers");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.containers));
  assert.ok(res.body.containers.length >= 4);
  assert.ok(res.body.containers.some((c) => c.id === "CONT-COLD-01"));
});

test("S-40 Adapter Error Handling: Handles 403 Forbidden and 409 Conflict without falling back to demo success", async () => {
  // Backup global fetch
  const originalFetch = global.fetch;

  try {
    // 1. Test 403 Forbidden on createShipment
    global.fetch = async () => ({
      status: 403,
      ok: false,
      json: async () => ({ error: "FORBIDDEN", message: "Inspector không có quyền mở chuyến" }),
    });

    const forbiddenRes = await ShipmentAdapter.createShipment({
      shipmentCode: "SHP-FORBIDDEN-01",
      containerId: "CONT-COLD-01",
      lotIds: ["LOT-001"],
      origin: "Kho A",
      destination: "Kho B",
      departureTime: new Date().toISOString(),
    });
    assert.equal(forbiddenRes.success, false);
    assert.equal(forbiddenRes.isForbidden, true);
    assert.match(forbiddenRes.message, /không có quyền mở chuyến/);

    // 2. Test 409 Conflict on createShipment (lot already in active shipment)
    global.fetch = async () => ({
      status: 409,
      ok: false,
      json: async () => ({
        error: "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
        message: "Lô hàng LOT-001 hiện đang trong chuyến vận chuyển khác",
      }),
    });

    const conflictRes = await ShipmentAdapter.createShipment({
      shipmentCode: "SHP-CONFLICT-01",
      containerId: "CONT-COLD-01",
      lotIds: ["LOT-001"],
      origin: "Kho A",
      destination: "Kho B",
      departureTime: new Date().toISOString(),
    });
    assert.equal(conflictRes.success, false);
    assert.equal(conflictRes.isConflict, true);
    assert.equal(conflictRes.error, "LOT_ALREADY_IN_ACTIVE_SHIPMENT");
    assert.match(conflictRes.message, /đang trong chuyến vận chuyển khác/);

    // 3. Test 403 Forbidden on completeShipment
    global.fetch = async () => ({
      status: 403,
      ok: false,
      json: async () => ({ error: "FORBIDDEN", message: "Inspector không có quyền kết thúc chuyến" }),
    });

    const completeForbiddenRes = await ShipmentAdapter.completeShipment("shp-001");
    assert.equal(completeForbiddenRes.success, false);
    assert.equal(completeForbiddenRes.isForbidden, true);
    assert.match(completeForbiddenRes.message, /không có quyền kết thúc/);

    // 4. Test 500 Internal Server Error does NOT fall back to sandbox success
    global.fetch = async () => ({
      status: 500,
      ok: false,
      json: async () => ({ message: "Lỗi kết nối cơ sở dữ liệu" }),
    });

    const serverErrRes = await ShipmentAdapter.createShipment({
      shipmentCode: "SHP-ERR-01",
      containerId: "CONT-COLD-01",
      lotIds: ["LOT-001"],
      origin: "Kho A",
      destination: "Kho B",
      departureTime: new Date().toISOString(),
    });
    assert.equal(serverErrRes.success, false);
    assert.match(serverErrRes.message, /Lỗi kết nối cơ sở dữ liệu/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("S-40 Permissions: Inspector has read-only access and cannot create or complete shipments", () => {
  const { hasPermission } = appShell;
  assert.equal(hasPermission("inspector", "shipment.create"), false);
  assert.equal(hasPermission("inspector", "shipment.complete"), false);
  assert.equal(hasPermission("transporter", "shipment.create"), true);
  assert.equal(hasPermission("transporter", "shipment.complete"), true);
  assert.equal(hasPermission("admin", "shipment.create"), true);
  assert.equal(hasPermission("admin", "shipment.complete"), true);
});
