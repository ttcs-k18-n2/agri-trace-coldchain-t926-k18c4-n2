const fs = require("node:fs/promises");

function selectScenario(document, scenarioId) {
  const scenarios = Array.isArray(document.scenarios) ? document.scenarios : [document];
  const selected = scenarioId
    ? scenarios.find((scenario) => scenario.id === scenarioId)
    : scenarios.length === 1 ? scenarios[0] : null;
  if (!selected || !Array.isArray(selected.readings) || selected.readings.length === 0) {
    throw new Error("Select one scenario with readings using --scenario <id>.");
  }
  return selected;
}

async function replayScenario({ endpoint, coldBoxId, scenario, baseTime, cookie, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Endpoint must be HTTP(S) without credentials in the URL.");
  }
  if (typeof coldBoxId !== "string" || !coldBoxId.trim()) throw new Error("Provide --cold-box <code>.");
  if (!scenario || !Array.isArray(scenario.readings) || !scenario.readings.length) {
    throw new Error("Scenario must contain readings.");
  }
  const anchor = baseTime === undefined ? Date.now() : Date.parse(baseTime);
  if (!Number.isFinite(anchor)) throw new Error("Invalid --base-time timestamp.");
  const firstAbsolute = scenario.readings.find((reading) => reading.timestamp !== undefined);
  const originalAnchor = firstAbsolute ? Date.parse(firstAbsolute.timestamp) : null;
  // Validate the entire input before sending the first request; preserve file order.
  const samples = scenario.readings.map((reading) => {
    if (typeof reading.temperature !== "number" || !Number.isFinite(reading.temperature)) {
      throw new Error("Every scenario temperature must be a finite number.");
    }
    let timestamp;
    if (reading.timestamp !== undefined) {
      if (typeof reading.timestamp !== "string") throw new Error("Invalid scenario timestamp.");
      timestamp = Date.parse(reading.timestamp);
      if (baseTime !== undefined) timestamp = anchor + timestamp - originalAnchor;
    } else {
      if (typeof reading.minute !== "number" || !Number.isFinite(reading.minute)) {
        throw new Error("Every reading needs a timestamp or relative minute.");
      }
      timestamp = anchor + reading.minute * 60000;
    }
    if (!Number.isFinite(timestamp)) throw new Error("Invalid scenario timestamp.");
    return { coldBoxId: coldBoxId.trim(), timestamp: new Date(timestamp).toISOString(), temperature: reading.temperature };
  });
  const report = { scenario: scenario.id || null, samples: samples.length, acknowledged: 0, ignored: 0 };
  for (let index = 0; index < samples.length; index++) {
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers.Cookie = cookie;
    const response = await fetchImpl(url, {
      method: "POST", headers, body: JSON.stringify(samples[index]), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Sensor endpoint returned HTTP ${response.status} at sample ${index + 1}.`);
    const acknowledgment = await response.json();
    if (acknowledgment.acknowledged !== true) throw new Error(`Invalid acknowledgment at sample ${index + 1}.`);
    report.acknowledged++;
    if (acknowledgment.ignored === true) report.ignored++;
  }
  return report;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = {};
  const names = new Set(["--file", "--scenario", "--endpoint", "--cold-box", "--base-time"]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!names.has(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("Usage: node scripts/simulate_sensor_s42.js --file <json> --scenario <id> --endpoint <S41 endpoint> --cold-box <code> [--base-time <ISO timestamp>]. Authentication uses SENSOR_SESSION_COOKIE from the environment.");
    }
    options[argv[index]] = argv[index + 1];
  }
  if (!options["--file"]) throw new Error("Provide --file <scenario.json>.");
  const scenario = selectScenario(JSON.parse(await fs.readFile(options["--file"], "utf8")), options["--scenario"]);
  return replayScenario({ endpoint: options["--endpoint"], coldBoxId: options["--cold-box"], scenario,
    baseTime: options["--base-time"], cookie: env.SENSOR_SESSION_COOKIE });
}

if (require.main === module) {
  main().then((report) => console.log(JSON.stringify(report))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { selectScenario, replayScenario, main };
