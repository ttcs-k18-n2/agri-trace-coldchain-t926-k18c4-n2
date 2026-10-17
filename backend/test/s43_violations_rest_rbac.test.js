const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  seedDemoUser,
  inMemoryShipments,
  inMemoryShipmentTemperatures,
  recordShipmentTemperature,
} = require("../src/server");
const {
  handleAcceptedTemperatureReading,
  inMemoryViolations,
  getViolations,
  getShipmentViolations,
  getColdBoxViolations,
} = require("../src/cold_chain_violation_service");

const BASE_TIME = Date.parse("2026-10-17T08:00:00.000Z");
const atMinute = (m) => new Date(BASE_TIME + m * 60000).toISOString();

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function loginUser(server, email, password) {
  const res = await request(
    server,
    {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  );
  return res.headers["set-cookie"] ? res.headers["set-cookie"][0].split(";")[0] : null;
}

function resetState() {
  inMemoryShipments.length = 0;
  inMemoryShipmentTemperatures.length = 0;
  inMemoryViolations.length = 0;
}

test("S-43 Phase 2 REST Violation Routes and RBAC Enforcement", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const cookieOrg1 = await loginUser(server, "user@example.com", "Password@123");
  const cookieOrg2 = await loginUser(server, "user2@example.com", "Password@123");
  const cookieInspector = await loginUser(server, "inspector@example.com", "Password@123");
  const cookieAdmin = await loginUser(server, "admin@example.com", "Password@123");

  await t.test("1. Unauthenticated access denial (HTTP 401)", async () => {
    resetState();
    // Shipment violations endpoint without cookie
    const resShipment = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/shipments/ship-test-01/violations",
      method: "GET",
    });
    assert.equal(resShipment.status, 401, "Unauthenticated request to shipment violations must return 401");

    // Cold-box violations endpoint without cookie
    const resColdBox = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/cold-boxes/CBX-001/violations",
      method: "GET",
    });
    assert.equal(resColdBox.status, 401, "Unauthenticated request to cold-box violations must return 401");
  });

  await t.test("2. Non-existent shipment returns 404", async () => {
    resetState();
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/shipments/non-existent-shipment/violations",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(res.status, 404, "Non-existent shipment must return 404");
    assert.equal(res.body?.error, "SHIPMENT_NOT_FOUND");
  });

  await t.test("3. GET violations for shipment with active ongoing excursion", async () => {
    resetState();
    const shipmentId = "ship-s43-ongoing";
    const coldBoxId = "CBX-S43-ONGOING";
    const orgId = "org-001";

    inMemoryShipments.push({
      id: shipmentId,
      coldBoxId,
      status: "IN_TRANSIT",
      organizationId: orgId,
      currentTemperature: 4.0,
      lastTemperatureAt: atMinute(0),
      startedAt: atMinute(0),
      createdAt: atMinute(0),
      detector_state: null,
    });

    const authContext = { userId: "usr-001", organizationId: orgId, roleId: "producer" };

    // Record temperature excursion starting at min 10 (9.0C) and continuing to min 41 (10.5C) > 30 min
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 9.0, timestamp: atMinute(10) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 10.5, timestamp: atMinute(41) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });

    // Query violations for shipment
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}/violations`,
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.shipmentId, shipmentId);
    assert.equal(res.body.coldBoxId, coldBoxId);
    assert.equal(res.body.organizationId, orgId);
    assert.equal(res.body.count, 1);
    assert.ok(Array.isArray(res.body.violations));
    assert.equal(res.body.violations.length, 1);

    const v = res.body.violations[0];
    assert.ok(v.id.startsWith("viol-"));
    assert.equal(v.startTime, atMinute(10));
    assert.equal(v.endTime, null, "Active ongoing excursion must have endTime null");
    assert.equal(v.peakTemperature, 10.5);
    assert.equal(v.durationMinutes, 31);
    assert.equal(v.status, "ONGOING");
    assert.equal(v.sampleCount, 2);

    // Summary contract
    assert.deepEqual(res.body.summary, {
      totalExcursions: 1,
      ongoingExcursions: 1,
      resolvedExcursions: 0,
      maxPeakTemperature: 10.5,
    });
  });

  await t.test("4. GET violations after resolution", async () => {
    resetState();
    const shipmentId = "ship-s43-resolved";
    const coldBoxId = "CBX-S43-RESOLVED";
    const orgId = "org-001";

    inMemoryShipments.push({
      id: shipmentId,
      coldBoxId,
      status: "IN_TRANSIT",
      organizationId: orgId,
      currentTemperature: 4.0,
      lastTemperatureAt: atMinute(0),
      startedAt: atMinute(0),
      createdAt: atMinute(0),
      detector_state: null,
    });

    const authContext = { userId: "usr-001", organizationId: orgId, roleId: "producer" };

    // Excursion from min 10 to min 41
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 9.0, timestamp: atMinute(10) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 11.0, timestamp: atMinute(41) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });
    // Temp drops to normal at min 51
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 5.0, timestamp: atMinute(51) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });
    // Remains normal past merge gap at min 57 (> 5 min gap) -> Resolved
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId, temperature: 4.5, timestamp: atMinute(57) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });

    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}/violations`,
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.violations.length, 1);

    const v = res.body.violations[0];
    assert.equal(v.status, "RESOLVED");
    assert.notEqual(v.endTime, null, "Resolved excursion must have valid ISO endTime");
    assert.equal(v.endTime, atMinute(41));
    assert.equal(v.peakTemperature, 11.0);
    assert.equal(v.durationMinutes, 31);
    assert.equal(v.sampleCount, 2);

    assert.deepEqual(res.body.summary, {
      totalExcursions: 1,
      ongoingExcursions: 0,
      resolvedExcursions: 1,
      maxPeakTemperature: 11.0,
    });
  });

  await t.test("5. Cross-tenant access denial (HTTP 403)", async () => {
    resetState();
    const shipmentId = "ship-s43-org1";
    const coldBoxId = "CBX-S43-ORG1";

    inMemoryShipments.push({
      id: shipmentId,
      coldBoxId,
      status: "IN_TRANSIT",
      organizationId: "org-001",
      startedAt: atMinute(0),
      createdAt: atMinute(0),
    });

    // User of org-002 attempts to view violations for shipment of org-001
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}/violations`,
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });

    assert.equal(res.status, 403, "Cross-tenant request must return 403 FORBIDDEN");
    assert.equal(res.body?.error, "FORBIDDEN");
  });

  await t.test("6. Inspector and admin read permissions (HTTP 200)", async () => {
    resetState();
    const shipmentId = "ship-s43-inspector";
    const coldBoxId = "CBX-S43-INSPECTOR";

    inMemoryShipments.push({
      id: shipmentId,
      coldBoxId,
      status: "IN_TRANSIT",
      organizationId: "org-001",
      startedAt: atMinute(0),
      createdAt: atMinute(0),
    });

    // Inspector access
    const resInspector = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}/violations`,
      method: "GET",
      headers: { Cookie: cookieInspector },
    });
    assert.equal(resInspector.status, 200, "Inspector must have read permission across tenants");
    assert.equal(resInspector.body.shipmentId, shipmentId);

    // Admin access
    const resAdmin = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}/violations`,
      method: "GET",
      headers: { Cookie: cookieAdmin },
    });
    assert.equal(resAdmin.status, 200, "Admin must have read permission across tenants");
    assert.equal(resAdmin.body.shipmentId, shipmentId);
  });

  await t.test("7. Cold-box violations endpoint (/api/cold-boxes/:code/violations)", async () => {
    resetState();
    const shipmentId = "ship-s43-coldbox";
    const coldBoxCode = "CBX-SPECIAL-99";
    const orgId = "org-001";

    inMemoryShipments.push({
      id: shipmentId,
      coldBoxId: coldBoxCode,
      status: "IN_TRANSIT",
      organizationId: orgId,
      startedAt: atMinute(0),
      createdAt: atMinute(0),
    });

    const authContext = { userId: "usr-001", organizationId: orgId, roleId: "producer" };
    // Create an ongoing excursion
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId: coldBoxCode, temperature: 9.5, timestamp: atMinute(10) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });
    await recordShipmentTemperature({
      authContext,
      data: { coldBoxId: coldBoxCode, temperature: 12.0, timestamp: atMinute(45) },
      onAcceptedReading: handleAcceptedTemperatureReading,
    });

    // 7.1 Org owner requests cold box violations
    const resOrg = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/cold-boxes/${coldBoxCode}/violations`,
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(resOrg.status, 200);
    assert.equal(resOrg.body.shipmentId, shipmentId);
    assert.equal(resOrg.body.coldBoxId, coldBoxCode);
    assert.equal(resOrg.body.organizationId, orgId);
    assert.equal(resOrg.body.count, 1);
    assert.equal(resOrg.body.summary.totalExcursions, 1);
    assert.equal(resOrg.body.summary.ongoingExcursions, 1);
    assert.equal(resOrg.body.summary.maxPeakTemperature, 12.0);

    // 7.2 Inspector requests cold box violations
    const resInspector = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/cold-boxes/${coldBoxCode}/violations`,
      method: "GET",
      headers: { Cookie: cookieInspector },
    });
    assert.equal(resInspector.status, 200);
    assert.equal(resInspector.body.shipmentId, shipmentId);

    // 7.3 Cross-tenant user requests cold box violations -> 403
    const resCrossTenant = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/cold-boxes/${coldBoxCode}/violations`,
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(resCrossTenant.status, 403);
    assert.equal(resCrossTenant.body?.error, "FORBIDDEN");

    // 7.4 Non-existent cold box -> 404
    const res404 = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/cold-boxes/NON-EXISTENT-CBX/violations",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(res404.status, 404);
  });
});

test("S-43 Service Unit Tests: Persistence, PostgreSQL Querying and Mapping", async () => {
  // Test mock PostgreSQL pool behavior for getShipmentViolations
  const mockRows = [
    {
      id: "viol-001",
      shipment_id: "ship-pg-01",
      cold_box_id: "CB-PG-01",
      organization_id: "org-001",
      threshold_value: "8.00",
      start_time: new Date("2026-10-17T08:10:00.000Z"),
      end_time: new Date("2026-10-17T08:45:00.000Z"),
      peak_temperature: "12.50",
      duration_minutes: "35.00",
      status: "ONGOING",
      excursions_count: 1,
      details: JSON.stringify({ readingsCount: 5 }),
    },
    {
      id: "viol-002",
      shipment_id: "ship-pg-01",
      cold_box_id: "CB-PG-01",
      organization_id: "org-001",
      threshold_value: "8.00",
      start_time: new Date("2026-10-17T09:00:00.000Z"),
      end_time: new Date("2026-10-17T09:40:00.000Z"),
      peak_temperature: "14.20",
      duration_minutes: "40.00",
      status: "RESOLVED",
      excursions_count: 1,
      details: { readingsCount: 8 },
    },
  ];

  const queriesExecuted = [];
  const mockPool = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql, params });
      if (sql.includes("FROM shipments")) {
        return {
          rows: [
            {
              id: "ship-pg-01",
              cold_box_id: "CB-PG-01",
              organization_id: "org-001",
              status: "IN_TRANSIT",
            },
          ],
        };
      }
      if (sql.includes("FROM temperature_violations")) {
        return { rows: mockRows };
      }
      return { rows: [] };
    },
  };

  const authContext = { userId: "usr-001", organizationId: "org-001", roleId: "producer" };
  const result = await getShipmentViolations({
    pool: mockPool,
    authContext,
    shipmentId: "ship-pg-01",
  });

  assert.equal(result.status, 200);
  assert.equal(result.shipmentId, "ship-pg-01");
  assert.equal(result.coldBoxId, "CB-PG-01");
  assert.equal(result.organizationId, "org-001");
  assert.equal(result.count, 2);

  // Check ONGOING mapping: endTime must be null
  assert.equal(result.violations[0].status, "ONGOING");
  assert.equal(result.violations[0].endTime, null);
  assert.equal(result.violations[0].peakTemperature, 12.5);
  assert.equal(result.violations[0].sampleCount, 5);

  // Check RESOLVED mapping: endTime must be ISO string
  assert.equal(result.violations[1].status, "RESOLVED");
  assert.equal(result.violations[1].endTime, "2026-10-17T09:40:00.000Z");
  assert.equal(result.violations[1].peakTemperature, 14.2);
  assert.equal(result.violations[1].sampleCount, 8);

  // Check summary
  assert.deepEqual(result.summary, {
    totalExcursions: 2,
    ongoingExcursions: 1,
    resolvedExcursions: 1,
    maxPeakTemperature: 14.2,
  });

  // Verify parameterized query was executed
  const tvQuery = queriesExecuted.find((q) => q.sql.includes("FROM temperature_violations"));
  assert.ok(tvQuery, "Must query temperature_violations table");
  assert.deepEqual(tvQuery.params, ["ship-pg-01"]);

  // Test getColdBoxViolations directly with mockPool
  const cbResult = await getColdBoxViolations({
    pool: mockPool,
    authContext,
    coldBoxCode: "CB-PG-01",
  });
  assert.equal(cbResult.status, 200);
  assert.equal(cbResult.coldBoxId, "CB-PG-01");
  assert.equal(cbResult.count, 2);

  // Test getViolations generic delegator
  const gResult = await getViolations({
    pool: mockPool,
    authContext,
    shipmentId: "ship-pg-01",
  });
  assert.equal(gResult.status, 200);
  assert.equal(gResult.shipmentId, "ship-pg-01");
});

