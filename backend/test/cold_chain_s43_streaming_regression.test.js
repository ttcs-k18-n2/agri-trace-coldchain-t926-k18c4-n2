const test = require('node:test');
const assert = require('node:assert/strict');
const { ColdChainViolationDetector } = require('../src/cold_chain_violation_service');
const origin = Date.parse('2026-10-17T23:40:00.000Z');
const point = (minutes, temperature) => ({ recordedAt: new Date(origin + minutes * 60000).toISOString(), temperature });

test('batch and incremental detection match the five independent Jira S42 fixture counts', () => {
  const { scenarios } = require('./fixtures/s42_jira_scenarios.json');
  assert.equal(scenarios.length, 5);
  for (const scenario of scenarios) {
    const detector = new ColdChainViolationDetector({ threshold: scenario.threshold });
    const samples = scenario.readings.map((reading) => reading.timestamp
      ? { recordedAt: reading.timestamp, temperature: reading.temperature }
      : point(reading.minute, reading.temperature));
    assert.equal(detector.evaluateSeries(samples).length, scenario.expectedViolationsCount, scenario.id);
    for (const sample of samples) detector.processReading(sample);
    assert.equal(detector.finalize().length, scenario.expectedViolationsCount, scenario.id);
  }
});

test('ongoing excursion emits immediately after 30 minutes and updates one stable violation', () => {
  const detector = new ColdChainViolationDetector({ threshold: 8 });
  detector.processReading(point(0, 9));
  assert.equal(detector.processReading(point(30, 10)).confirmedViolations.length, 0);
  const ongoing = detector.processReading(point(31, 11)).confirmedViolations;
  assert.equal(ongoing.length, 1);
  assert.equal(ongoing[0].status, 'ONGOING');
  const id = ongoing[0].id;
  const updated = detector.processReading(point(45, 14)).confirmedViolations;
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, id);
  assert.equal(updated[0].peakTemperature, 14);
  assert.equal(updated[0].durationMinutes, 45);
  detector.processReading(point(46, 4));
  const resolved = detector.processReading(point(50, 4)).confirmedViolations;
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, id);
  assert.equal(resolved[0].status, 'RESOLVED');
  assert.equal(detector.finalize().length, 1);
  assert.equal(detector.finalize().length, 1);
});

test('older and equal readings leave excursion, timestamp and peak unchanged', () => {
  const detector = new ColdChainViolationDetector({ threshold: 8 });
  detector.processReading(point(0, 9));
  const state = detector.processReading(point(35, 12));
  const timestamp = detector.latestTimestamp;
  for (const sample of [point(20, 99), point(35, 99)]) {
    const ignored = detector.processReading(sample);
    assert.equal(ignored.ignored, true);
    assert.equal(detector.latestTimestamp, timestamp);
    assert.deepEqual(ignored.confirmedViolations, state.confirmedViolations);
    assert.equal(ignored.activeExcursion.peakTemperature, 12);
  }
});

test('a short gap updates the same violation, but exactly five minutes starts a new one', () => {
  for (const [gap, expected] of [[299 / 60, 1], [5, 2]]) {
    const detector = new ColdChainViolationDetector({ threshold: 8 });
    detector.processReading(point(0, 9));
    const first = detector.processReading(point(40, 11)).confirmedViolations[0];
    assert.ok(first);
    detector.processReading(point(40.01, 4));
    detector.processReading(point(40 + gap, 9));
    detector.processReading(point(80 + gap, 13));
    const result = detector.finalize();
    assert.equal(result.length, expected);
    assert.equal(result[0].id, first.id);
    if (expected === 1) assert.equal(result[0].excursionsCount, 2);
  }
});

test('streaming keeps bounded sample storage and rejects non-finite temperatures', () => {
  const detector = new ColdChainViolationDetector();
  for (let index = 0; index < 1000; index++) detector.processReading(point(index, 4));
  assert.ok(detector.windowReadings.length <= 1);
  assert.throws(() => detector.processReading(point(1001, Infinity)));
  assert.throws(() => detector.processReading(point(1001, true)));
  assert.equal(detector.latestTimestamp, Date.parse(point(999, 4).recordedAt));
});
