const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const frontendDir = path.resolve(__dirname, "../../frontend");
const adapterPath = path.join(frontendDir, "shipment-adapter.js");
const shipmentsJsPath = path.join(frontendDir, "shipments.js");

const ShipmentAdapter = require(adapterPath);
const ShipmentsUI = require(shipmentsJsPath);

test("S-41 Telemetry Normalizer: Never invents temperature (No 4.2 fallback)", () => {
  // Absent temperature field
  const absentRes = ShipmentAdapter.normalizeShipment({ id: "shp-1", code: "SHP-001" });
  assert.equal(absentRes.currentTemp, null, "Must be null when telemetry is absent");
  assert.equal(absentRes.currentTemperature, null);
  assert.equal(absentRes.current_temperature, null);
  assert.notEqual(absentRes.currentTemp, 4.2, "Must NOT fallback to 4.2");

  // Explicit null temperature
  const nullRes = ShipmentAdapter.normalizeShipment({
    id: "shp-2",
    code: "SHP-002",
    current_temperature: null,
    last_temperature_at: null,
  });
  assert.equal(nullRes.currentTemp, null, "Must be null when current_temperature is null");
  assert.equal(nullRes.currentTemperature, null);
  assert.equal(nullRes.lastTemperatureAt, null);

  // Explicit undefined or empty string
  const emptyRes = ShipmentAdapter.normalizeShipment({
    id: "shp-3",
    current_temp: undefined,
    currentTemperature: "",
  });
  assert.equal(emptyRes.currentTemp, null);
});

test("S-41 Telemetry Normalizer: Preserves measured 0 (Cold Chain edge case)", () => {
  // 0 in snake_case
  const zeroSnake = ShipmentAdapter.normalizeShipment({
    id: "shp-zero-1",
    current_temperature: 0,
    last_temperature_at: "2026-10-17T10:00:00.000Z",
  });
  assert.equal(zeroSnake.currentTemp, 0, "Measured 0 must be preserved");
  assert.equal(zeroSnake.currentTemperature, 0);
  assert.equal(zeroSnake.current_temperature, 0);

  // 0 in camelCase
  const zeroCamel = ShipmentAdapter.normalizeShipment({
    id: "shp-zero-2",
    currentTemperature: 0,
  });
  assert.equal(zeroCamel.currentTemp, 0);
  assert.equal(zeroCamel.currentTemperature, 0);

  // 0 in legacy field name current_temp
  const zeroLegacy = ShipmentAdapter.normalizeShipment({
    id: "shp-zero-3",
    current_temp: 0,
  });
  assert.equal(zeroLegacy.currentTemp, 0);
});

test("S-41 Telemetry Normalizer: Preserves negative finite temperatures", () => {
  // Deep freeze temperature: -18.5 C
  const freezeRes = ShipmentAdapter.normalizeShipment({
    id: "shp-freeze",
    current_temperature: -18.5,
    last_temperature_at: "2026-10-17T11:00:00.000Z",
  });
  assert.equal(freezeRes.currentTemp, -18.5);
  assert.equal(freezeRes.currentTemperature, -18.5);
  assert.equal(freezeRes.lastTemperatureAt, "2026-10-17T11:00:00.000Z");

  // Borderline negative temperature: -0.5 C
  const chillRes = ShipmentAdapter.normalizeShipment({
    id: "shp-chill",
    currentTemperature: -0.5,
  });
  assert.equal(chillRes.currentTemp, -0.5);
});

test("S-41 Telemetry Normalizer: Documented casing and real latest timestamp", () => {
  const recordedTime = "2026-10-17T12:00:00.000Z";

  // Documented snake_case contract fields (Postgres & S41_API_CONTRACT.md schema)
  const snakeContract = ShipmentAdapter.normalizeShipment({
    id: "shp-snake",
    cold_box_id: "CB-001",
    current_temperature: 4.8,
    last_temperature_at: recordedTime,
  });
  assert.equal(snakeContract.currentTemperature, 4.8);
  assert.equal(snakeContract.lastTemperatureAt, recordedTime);
  assert.equal(snakeContract.last_temperature_at, recordedTime);

  // Documented camelCase contract fields (service getShipmentById JSON response)
  const camelContract = ShipmentAdapter.normalizeShipment({
    id: "shp-camel",
    coldBoxId: "CB-002",
    currentTemperature: 3.2,
    lastTemperatureAt: recordedTime,
  });
  assert.equal(camelContract.currentTemperature, 3.2);
  assert.equal(camelContract.lastTemperatureAt, recordedTime);
});

test("S-41 UI Telemetry Helpers: Truthful status without invented 0..10C thresholds", () => {
  const { getTempStatusClass, getSensorStatusInfo } = ShipmentsUI;

  // When temperature is missing (null / undefined / NaN)
  assert.equal(getTempStatusClass(null), "temp-unknown");
  assert.equal(getTempStatusClass(undefined), "temp-unknown");
  assert.equal(getTempStatusClass(NaN), "temp-unknown");

  const missingSensor = getSensorStatusInfo(null);
  assert.equal(missingSensor.label, "Chưa có dữ liệu", "Must NOT report Bình thường when no telemetry");
  assert.notEqual(missingSensor.label, "Bình thường");
  assert.equal(missingSensor.badgeClass, "badge-status-default");

  // When temperature is measured (0, negative, or positive) WITHOUT domain status:
  // Must NOT invent temp-normal or temp-warning (no hardcoded 0..10C thresholds)
  assert.equal(getTempStatusClass(0), "temp-measured");
  assert.notEqual(getTempStatusClass(0), "temp-normal");
  assert.notEqual(getTempStatusClass(0), "temp-warning");

  assert.equal(getTempStatusClass(-3.5), "temp-measured");
  assert.notEqual(getTempStatusClass(-3.5), "temp-warning");

  assert.equal(getTempStatusClass(12.0), "temp-measured");
  assert.notEqual(getTempStatusClass(12.0), "temp-warning");

  const zeroSensor = getSensorStatusInfo(0);
  assert.notEqual(zeroSensor.label, "Bình thường", "Must NOT invent 'Bình thường' without domain status");
  assert.notEqual(zeroSensor.label, "Cảnh báo nhiệt độ");

  // When actual backend/configured domain status IS present:
  assert.equal(getTempStatusClass(12.0, "ALERT"), "temp-warning");
  assert.equal(getTempStatusClass(4.0, "NORMAL"), "temp-normal");
  assert.equal(getSensorStatusInfo(12.0, "ALERT").label, "Cảnh báo nhiệt độ");
  assert.equal(getSensorStatusInfo(4.0, "NORMAL").label, "Bình thường");
});

test("S-41 UI HTML Rendering: shipments.html has proper CSS classes and semantic telemetry placeholders", () => {
  const html = fs.readFileSync(path.join(frontendDir, "shipments.html"), "utf8");

  // CSS rule for unknown temperature display
  assert.match(html, /\.temp-unknown\s+\.temp-val/, "Must contain CSS rule for .temp-unknown .temp-val");

  // Existing KPI cards and layout remain intact
  assert.match(html, /id=["']kpiContainers["']/);
  assert.match(html, /id=["']shipmentsContainer["']/);
  assert.match(html, /id=["']modalShipmentDetail["']/);
});

test("S-41 Regression: Existing ShipmentAdapter functionality remains fully backward compatible", () => {
  assert.equal(typeof ShipmentAdapter.listShipments, "function");
  assert.equal(typeof ShipmentAdapter.getShipmentDetail, "function");
  assert.equal(typeof ShipmentAdapter.createShipment, "function");
  assert.equal(typeof ShipmentAdapter.completeShipment, "function");
  assert.equal(typeof ShipmentAdapter.validateShipmentPayload, "function");
  assert.equal(typeof ShipmentAdapter.fetchAvailableLots, "function");
  assert.equal(typeof ShipmentAdapter.fetchColdContainers, "function");
  assert.equal(typeof ShipmentAdapter.formatShipmentStatus, "function");

  // Valid payload validation
  const valid = ShipmentAdapter.validateShipmentPayload({
    shipmentCode: "SHP-202610-099",
    containerId: "CONT-COLD-01",
    lotIds: ["LOT-001"],
    origin: "Kho A",
    destination: "Kho B",
    departureTime: new Date().toISOString(),
  });
  assert.equal(valid.isValid, true);
});
