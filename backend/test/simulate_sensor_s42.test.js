const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { selectScenario, replayScenario, main } = require("../scripts/simulate_sensor_s42");
const fixtures = require("./fixtures/s42_jira_scenarios.json");

async function serverFor(t, handler) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(req, JSON.parse(body), res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/api/shipments/temperatures`;
}

test("replays a 45-minute scenario from its file without waiting in real time", async (t) => {
  const received = [];
  const endpoint = await serverFor(t, (req, body, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/shipments/temperatures");
    assert.equal(req.headers.cookie, "sid=local-fixture");
    received.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ acknowledged: true, ignored: received.length === 2 }));
  });
  const started = Date.now();
  const report = await main(["--file", path.join(__dirname, "fixtures/s42_jira_scenarios.json"),
    "--scenario", "S42-JIRA-03", "--endpoint", endpoint, "--cold-box", "CB-001",
    "--base-time", "2026-10-17T08:00:00.000Z"], { SENSOR_SESSION_COOKIE: "sid=local-fixture" });
  const scenario = selectScenario(fixtures, "S42-JIRA-03");
  assert.deepEqual(received.map((sample) => sample.temperature), scenario.readings.map((sample) => sample.temperature));
  assert.deepEqual(received.map((sample) => sample.timestamp), scenario.readings.map((sample) =>
    new Date(Date.parse("2026-10-17T08:00:00.000Z") + sample.minute * 60000).toISOString()));
  assert.ok(received.every((sample) => sample.coldBoxId === "CB-001"));
  assert.deepEqual(report, { scenario: "S42-JIRA-03", samples: received.length, acknowledged: received.length, ignored: 1 });
  assert.ok(Date.now() - started < 10000, "accelerated playback must not wait 45 minutes");
  assert.ok(!JSON.stringify(report).includes("local-fixture"));
});

test("preserves explicit midnight timestamps and input order", async () => {
  const scenario = selectScenario(fixtures, "S42-JIRA-05");
  const received = [];
  await replayScenario({ endpoint: "http://127.0.0.1/api/shipments/temperatures", coldBoxId: "CB-001", scenario,
    fetchImpl: async (_url, options) => { received.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ acknowledged: true }) }; } });
  assert.deepEqual(received.map((sample) => sample.timestamp), scenario.readings.map((sample) => sample.timestamp));
  assert.ok(new Set(received.map((sample) => sample.timestamp.slice(0, 10))).size > 1);
});

test("stops at the first HTTP failure without replaying more samples", async (t) => {
  let requests = 0;
  const endpoint = await serverFor(t, (_req, _body, res) => {
    requests++;
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "FORBIDDEN" }));
  });
  await assert.rejects(replayScenario({ endpoint, coldBoxId: "CB-001", scenario: fixtures.scenarios[2] }), /HTTP 403 at sample 1/);
  assert.equal(requests, 1);
});

test("rejects ambiguous or invalid fixtures before making any HTTP request", async () => {
  assert.throws(() => selectScenario(fixtures), /Select one scenario/);
  assert.throws(() => selectScenario(fixtures, "missing"), /Select one scenario/);
  let requests = 0;
  const options = { endpoint: "http://127.0.0.1/api/shipments/temperatures", coldBoxId: "CB-001",
    scenario: { readings: [{ minute: 0, temperature: 4 }, { minute: 1, temperature: null }] },
    fetchImpl: async () => { requests++; throw new Error("unexpected request"); } };
  await assert.rejects(replayScenario(options), /finite number/);
  assert.equal(requests, 0);
});
