const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const request = require("supertest");
const { Pool } = require("pg");
const {
  app,
  users,
  seedDemoUser,
  GENESIS_HASH,
  calculateEventHash,
  verifyBatchEventChain,
  verifyBatchIntegrity,
  inMemoryLots,
} = require("../src/server");

async function loginAs(email, password = "Password@123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test.beforeEach(async () => {
  users.clear();
  await seedDemoUser();
});

test("S-12 / T-28: verifyBatchEventChain handles empty, single, and 10 valid events correctly", () => {
  // 1. Empty events
  const emptyRes = verifyBatchEventChain([]);
  assert.deepEqual(emptyRes, { valid: true, eventCount: 0, finalHash: null });

  // 2. Single event
  const singleEvent = {
    id: "EVT-001",
    batchId: "LOT-001",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    payload: { farmId: "FARM-001", quantity: 50 },
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: "2026-10-04T08:00:00.000Z",
    previousHash: GENESIS_HASH,
  };
  singleEvent.eventHash = calculateEventHash(GENESIS_HASH, singleEvent);

  const singleRes = verifyBatchEventChain([singleEvent]);
  assert.equal(singleRes.valid, true);
  assert.equal(singleRes.eventCount, 1);
  assert.equal(singleRes.finalHash, singleEvent.eventHash);

  // 3. Chain of 10 valid events
  const chain = [];
  let prevHash = GENESIS_HASH;
  for (let i = 1; i <= 10; i++) {
    const ev = {
      id: `EVT-${String(i).padStart(3, "0")}`,
      batchId: "LOT-001",
      sequenceNo: i,
      eventType: i === 1 ? "HARVEST_CREATED" : "STATUS_UPDATED",
      payload: { step: i, note: `Stage ${i}` },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: `2026-10-04T08:${String(i).padStart(2, "0")}:00.000Z`,
      previousHash: prevHash,
    };
    ev.eventHash = calculateEventHash(prevHash, ev);
    prevHash = ev.eventHash;
    chain.push(ev);
  }

  const validRes = verifyBatchEventChain(chain);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.eventCount, 10);
  assert.equal(validRes.finalHash, prevHash);
});

test("S-12 / T-28: verifyBatchEventChain detects content tampering (CONTENT_TAMPERED)", () => {
  // Build 10 valid events
  const chain = [];
  let prevHash = GENESIS_HASH;
  for (let i = 1; i <= 10; i++) {
    const ev = {
      id: `EVT-${String(i).padStart(3, "0")}`,
      batchId: "LOT-001",
      sequenceNo: i,
      eventType: "STAGE_RECORDED",
      payload: { stage: i, temperature: 20 },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: `2026-10-04T08:${String(i).padStart(2, "0")}:00.000Z`,
      previousHash: prevHash,
    };
    ev.eventHash = calculateEventHash(prevHash, ev);
    prevHash = ev.eventHash;
    chain.push(ev);
  }

  // Sửa lén payload của event #5
  const tamperedChain = JSON.parse(JSON.stringify(chain));
  tamperedChain[4].payload.temperature = 99; // event #5 (0-indexed 4)

  const tamperedRes = verifyBatchEventChain(tamperedChain);
  assert.equal(tamperedRes.valid, false);
  assert.equal(tamperedRes.type, "CONTENT_TAMPERED");
  assert.equal(tamperedRes.firstInvalidSequence, 5);
  assert.equal(tamperedRes.eventId, "EVT-005");
  assert.equal(tamperedRes.suspiciousFrom, 5);
});

test("S-12 / T-28: verifyBatchEventChain detects deleted events and sequence gaps (BROKEN_CHAIN)", () => {
  const chain = [];
  let prevHash = GENESIS_HASH;
  for (let i = 1; i <= 10; i++) {
    const ev = {
      id: `EVT-${String(i).padStart(3, "0")}`,
      batchId: "LOT-001",
      sequenceNo: i,
      eventType: "STAGE_RECORDED",
      payload: { stage: i },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: `2026-10-04T08:${String(i).padStart(2, "0")}:00.000Z`,
      previousHash: prevHash,
    };
    ev.eventHash = calculateEventHash(prevHash, ev);
    prevHash = ev.eventHash;
    chain.push(ev);
  }

  // Xóa event #5 (sequence nhảy từ 4 -> 6)
  const brokenChain = chain.filter((e) => e.sequenceNo !== 5);
  const brokenRes = verifyBatchEventChain(brokenChain);

  assert.equal(brokenRes.valid, false);
  assert.equal(brokenRes.type, "BROKEN_CHAIN");
  assert.equal(brokenRes.firstInvalidSequence, 5);
  assert.equal(brokenRes.actualSequence, 6);
  assert.equal(brokenRes.suspiciousFrom, 5);
});

test("S-12 / T-28: verifyBatchEventChain detects hash pointer disconnect (BROKEN_CHAIN)", () => {
  const chain = [];
  let prevHash = GENESIS_HASH;
  for (let i = 1; i <= 6; i++) {
    const ev = {
      id: `EVT-${String(i).padStart(3, "0")}`,
      batchId: "LOT-001",
      sequenceNo: i,
      eventType: "STAGE_RECORDED",
      payload: { stage: i },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: `2026-10-04T08:${String(i).padStart(2, "0")}:00.000Z`,
      previousHash: prevHash,
    };
    ev.eventHash = calculateEventHash(prevHash, ev);
    prevHash = ev.eventHash;
    chain.push(ev);
  }

  // Thay đổi previous_hash của event #4
  const alteredPrevHashChain = JSON.parse(JSON.stringify(chain));
  alteredPrevHashChain[3].previousHash = "000000000000000000000000000000000000000000000000000000000000dead";

  const res = verifyBatchEventChain(alteredPrevHashChain);
  assert.equal(res.valid, false);
  assert.equal(res.type, "BROKEN_CHAIN");
  assert.equal(res.firstInvalidSequence, 4);
});

test("S-12 / T-29: API GET /api/lots/:id/integrity role permissions and response contract", async () => {
  // Ensure test lot in memory
  const testLot = {
    id: "LOT-INTEG-001",
    organizationId: "org-001",
    farmId: "FARM-001",
    productId: "PROD-TEA",
  };
  if (!inMemoryLots.some((l) => l.id === testLot.id)) {
    inMemoryLots.push(testLot);
  }

  // 1. Anonymous access is 401
  const anonRes = await request(app).get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(anonRes.status, 401);

  // 2. Producer / Cooperative / Transporter are 403 Forbidden
  const producerAgent = await loginAs("user@example.com");
  const prodRes = await producerAgent.get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(prodRes.status, 403);

  const coopAgent = await loginAs("user2@example.com");
  const coopRes = await coopAgent.get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(coopRes.status, 403);

  const transporterAgent = await loginAs("transporter@example.com");
  const transRes = await transporterAgent.get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(transRes.status, 403);

  // 3. Inspector has access -> 200 OK
  const inspectorAgent = await loginAs("inspector@example.com");
  const inspRes = await inspectorAgent.get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(inspRes.status, 200);
  assert.equal(inspRes.body.lotId, testLot.id);
  assert.ok(inspRes.body.checkedAt);
  assert.equal(inspRes.body.integrity.valid, true);

  // 4. Admin has access -> 200 OK
  const adminAgent = await loginAs("admin@example.com");
  const adminRes = await adminAgent.get(`/api/lots/${testLot.id}/integrity`);
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.body.lotId, testLot.id);
  assert.equal(adminRes.body.integrity.valid, true);

  // 5. Non-existent lot -> 404
  const notFoundRes = await inspectorAgent.get("/api/lots/LOT-NON-EXISTENT/integrity");
  assert.equal(notFoundRes.status, 404);
});

test("S-12 / T-30 Benchmark: 1,000 chained events verified in < 1,000 ms", () => {
  const thousandEvents = [];
  let prevHash = GENESIS_HASH;

  for (let i = 1; i <= 1000; i++) {
    const ev = {
      id: `EVT-${String(i).padStart(6, "0")}`,
      batchId: "LOT-BENCH-1000",
      sequenceNo: i,
      eventType: "COLD_CHAIN_METRIC",
      payload: { temperature: 4.5, humidity: 85, sensorId: "SENS-01" },
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt: new Date(1700000000000 + i * 1000).toISOString(),
      previousHash: prevHash,
    };
    ev.eventHash = calculateEventHash(prevHash, ev);
    prevHash = ev.eventHash;
    thousandEvents.push(ev);
  }

  const start = performance.now();
  const result = verifyBatchEventChain(thousandEvents);
  const elapsed = performance.now() - start;

  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 1000);
  assert.equal(result.finalHash, prevHash);
  assert.ok(
    elapsed < 1000,
    `Benchmark failed: verifying 1,000 events took ${elapsed.toFixed(2)}ms (must be < 1000ms)`
  );
});

test("S-12 / T-30 Live PostgreSQL: Case A, Case B, Case C, Case D tampering tests", async (t) => {
  const MIGRATION_DB_URL =
    process.env.MIGRATION_DATABASE_URL || "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";

  let migrationDb;
  try {
    migrationDb = new Pool({ connectionString: MIGRATION_DB_URL, connectionTimeoutMillis: 3000 });
    await migrationDb.query("SELECT 1;");
  } catch (err) {
    t.skip(`PostgreSQL not reachable (${err.message}), skipping live tampering integration test`);
    return;
  }

  const testBatchId = `LOT-PG-TAMPER-${Date.now().toString(36).toUpperCase()}`;

  t.after(async () => {
    try {
      await migrationDb.query("DELETE FROM batch_events WHERE batch_id = $1", [testBatchId]);
      await migrationDb.query("DELETE FROM lots WHERE id = $1", [testBatchId]);
      await migrationDb.end();
    } catch {
      // best-effort cleanup
    }
  });

  // Setup lot
  await migrationDb.query(`
    INSERT INTO lots (id, name, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at)
    VALUES ($1, 'Tamper Test Lot', 'org-001', 'FARM-001', 'PROD-TEA', 100, 100, '2026-10-04')
    ON CONFLICT (id) DO NOTHING;
  `, [testBatchId]);

  // Seed 10 events
  let prevHash = GENESIS_HASH;
  for (let i = 1; i <= 10; i++) {
    const occurredAt = new Date(1700000000000 + i * 1000).toISOString();
    const payload = { stage: i, temperature: 20 + i };
    const eventHash = calculateEventHash(prevHash, {
      batchId: testBatchId,
      sequenceNo: i,
      eventType: "STAGE_RECORDED",
      payload,
      organizationId: "org-001",
      actorUserId: "usr-001",
      occurredAt,
    });

    await migrationDb.query(`
      INSERT INTO batch_events (
        id, batch_id, sequence_no, event_type, payload,
        organization_id, actor_user_id, occurred_at,
        previous_hash, event_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      `EVT-${testBatchId}-${i}`,
      testBatchId,
      i,
      "STAGE_RECORDED",
      JSON.stringify(payload),
      "org-001",
      "usr-001",
      occurredAt,
      prevHash,
      eventHash,
    ]);

    prevHash = eventHash;
  }

  // Case A: Untampered chain -> valid
  const caseA = await verifyBatchIntegrity(migrationDb, testBatchId);
  assert.equal(caseA.valid, true);
  assert.equal(caseA.eventCount, 10);
  assert.equal(caseA.finalHash, prevHash);

  // Case B: Migration user updates event #5 payload -> CONTENT_TAMPERED at sequence 5
  await migrationDb.query(`
    UPDATE batch_events
    SET payload = '{"stage": 5, "temperature": 99}'
    WHERE batch_id = $1 AND sequence_no = 5;
  `, [testBatchId]);

  const caseB = await verifyBatchIntegrity(migrationDb, testBatchId);
  assert.equal(caseB.valid, false);
  assert.equal(caseB.type, "CONTENT_TAMPERED");
  assert.equal(caseB.firstInvalidSequence, 5);
  assert.equal(caseB.suspiciousFrom, 5);

  // Revert event #5 back
  const originalPayload = { stage: 5, temperature: 25 };
  await migrationDb.query(`
    UPDATE batch_events
    SET payload = $2
    WHERE batch_id = $1 AND sequence_no = 5;
  `, [testBatchId, JSON.stringify(originalPayload)]);

  // Case C: Migration user deletes event #5 -> BROKEN_CHAIN
  await migrationDb.query(`
    DELETE FROM batch_events
    WHERE batch_id = $1 AND sequence_no = 5;
  `, [testBatchId]);

  const caseC = await verifyBatchIntegrity(migrationDb, testBatchId);
  assert.equal(caseC.valid, false);
  assert.equal(caseC.type, "BROKEN_CHAIN");
  assert.equal(caseC.firstInvalidSequence, 5);

  // Case D: Single event lot -> valid
  const singleBatchId = `LOT-PG-SINGLE-${Date.now().toString(36).toUpperCase()}`;
  await migrationDb.query(`
    INSERT INTO lots (id, name, organization_id, farm_id, product_id, initial_quantity, remaining_quantity, harvested_at)
    VALUES ($1, 'Single Event Lot', 'org-001', 'FARM-001', 'PROD-TEA', 50, 50, '2026-10-04');
  `, [singleBatchId]);

  const singleOccurred = new Date().toISOString();
  const singlePayload = { initial: true };
  const singleHash = calculateEventHash(GENESIS_HASH, {
    batchId: singleBatchId,
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    payload: singlePayload,
    organizationId: "org-001",
    actorUserId: "usr-001",
    occurredAt: singleOccurred,
  });

  await migrationDb.query(`
    INSERT INTO batch_events (
      id, batch_id, sequence_no, event_type, payload,
      organization_id, actor_user_id, occurred_at,
      previous_hash, event_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    `EVT-${singleBatchId}-1`,
    singleBatchId,
    1,
    "HARVEST_CREATED",
    JSON.stringify(singlePayload),
    "org-001",
    "usr-001",
    singleOccurred,
    GENESIS_HASH,
    singleHash,
  ]);

  const caseD = await verifyBatchIntegrity(migrationDb, singleBatchId);
  assert.equal(caseD.valid, true);
  assert.equal(caseD.eventCount, 1);
  assert.equal(caseD.finalHash, singleHash);

  // Cleanup single
  await migrationDb.query("DELETE FROM batch_events WHERE batch_id = $1", [singleBatchId]);
  await migrationDb.query("DELETE FROM lots WHERE id = $1", [singleBatchId]);
});
