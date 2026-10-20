const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_BATCH_SIZE,
  scanLotsInBatches,
  runIntegrityCheck,
  initIntegrityCheckJob,
} = require("../src/jobs/integrityCheckJob");

test("S-55: Cấu hình mặc định đúng lịch 2:00 sáng và LIMIT 100", async () => {
  assert.equal(DEFAULT_CRON_SCHEDULE, "0 2 * * *", "Lịch cron mặc định phải là 2:00 AM hàng ngày");
  assert.equal(DEFAULT_BATCH_SIZE, 100, "LIMIT mặc định mỗi đợt quét phải là 100");
  assert.equal(typeof runIntegrityCheck, "function", "runIntegrityCheck phải là hàm hợp lệ");
  const checkRes = await runIntegrityCheck({ mockLots: [] });
  assert.equal(checkRes.success, true);
});

test("S-55: Quét theo từng lô nhỏ (LIMIT 100) tránh khóa bảng sự kiện", async () => {
  const mockLots = Array.from({ length: 250 }, (_, i) => ({
    id: `LOT-${String(i + 1).padStart(3, "0")}`,
  }));

  const res = await scanLotsInBatches({
    mockLots,
    batchSize: 100,
    delayBetweenBatchesMs: 2,
    verifier: async (_client, _lotId) => ({ valid: true, eventCount: 2 }),
  });

  assert.equal(res.success, true);
  assert.equal(res.totalScanned, 250);
  assert.equal(res.validCount, 250);
  assert.equal(res.invalidCount, 0);
  assert.equal(res.batchesCount, 3, "250 lô chia theo LIMIT 100 phải quét thành 3 batch (100, 100, 50)");
});

test("S-55: Xử lý an toàn try/catch khi phát hiện lỗi toàn vẹn hoặc ngoại lệ", async () => {
  const mockLots = [
    { id: "LOT-OK-1" },
    { id: "LOT-FAIL-TAMPERED" },
    { id: "LOT-OK-2" },
    { id: "LOT-ERROR-EXCEPTION" },
  ];

  const res = await scanLotsInBatches({
    mockLots,
    batchSize: 2,
    delayBetweenBatchesMs: 0,
    verifier: async (_client, lotId) => {
      if (lotId === "LOT-FAIL-TAMPERED") {
        return { valid: false, error: "CONTENT_TAMPERED tại sự kiện #2" };
      }
      if (lotId === "LOT-ERROR-EXCEPTION") {
        throw new Error("Mất kết nối mạng tạm thời");
      }
      return { valid: true };
    },
  });

  assert.equal(res.success, true, "Job không được bị crash");
  assert.equal(res.totalScanned, 4);
  assert.equal(res.validCount, 2);
  assert.equal(res.invalidCount, 2);
  assert.equal(res.invalidLots.length, 2);
  assert.equal(res.invalidLots[0].lotId, "LOT-FAIL-TAMPERED");
  assert.equal(res.invalidLots[1].lotId, "LOT-ERROR-EXCEPTION");
});

test("S-55: Mô phỏng quét qua pool PostgreSQL với phân trang LIMIT/OFFSET", async () => {
  const allDbLots = Array.from({ length: 150 }, (_, i) => ({ id: `DB-LOT-${i + 1}` }));
  const queries = [];

  const mockPool = {
    async query(sql, params) {
      queries.push({ sql, params });
      const [limit, offset] = params;
      const rows = allDbLots.slice(offset, offset + limit);
      return { rows };
    },
  };

  const res = await scanLotsInBatches({
    pool: mockPool,
    batchSize: 100,
    delayBetweenBatchesMs: 1,
    verifier: async () => ({ valid: true }),
  });

  assert.equal(res.totalScanned, 150);
  assert.equal(res.batchesCount, 2);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, [100, 0]);
  assert.deepEqual(queries[1].params, [100, 100]);
});

test("S-55: Khởi tạo và dừng cron job thành công", () => {
  const task = initIntegrityCheckJob({
    cronExpression: "0 2 * * *",
    scheduled: false,
  });

  assert.ok(task, "Job task phải được tạo");
  assert.equal(typeof task.stop, "function", "Task phải có method stop()");
  assert.equal(typeof task.start, "function", "Task phải có method start()");
  task.stop();
});

test("S-55: Bảo mật production - Tuyệt đối không tự sinh 250 lô giả trong môi trường production", async () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const res = await scanLotsInBatches({
      pool: null,
      mockLots: null,
      inMemoryContext: { inMemoryLots: [] },
    });

    assert.equal(res.success, true);
    assert.equal(res.totalScanned, 0, "Không được tự sinh bất kỳ lô giả nào trong production");
    assert.equal(res.compromisedLotsCount, 0);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test("S-55: Phát hiện chuỗi hash bị sửa lén hoặc thiếu sự kiện (đứt mạch)", async () => {
  const { verifyBatchEventChain } = require("../src/integrity_verifier");
  const { GENESIS_HASH, calculateEventHash } = require("../src/integrity");

  // Sự kiện 1
  const ev1Data = {
    batchId: "LOT-BROKEN-TEST",
    sequenceNo: 1,
    eventType: "HARVEST_CREATED",
    occurredAt: "2026-10-18T01:00:00Z",
    payload: { qty: 100 },
  };
  const ev1Hash = calculateEventHash(GENESIS_HASH, ev1Data);

  // Sự kiện 3 (thiếu sự kiện 2)
  const ev3Data = {
    batchId: "LOT-BROKEN-TEST",
    sequenceNo: 3,
    eventType: "TRANSFER",
    occurredAt: "2026-10-18T03:00:00Z",
    payload: { toOrg: "org-2" },
  };
  const ev3Hash = calculateEventHash(ev1Hash, ev3Data);

  const brokenEvents = [
    { id: "e1", ...ev1Data, previousHash: GENESIS_HASH, eventHash: ev1Hash },
    { id: "e3", ...ev3Data, previousHash: ev1Hash, eventHash: ev3Hash },
  ];

  const verification = verifyBatchEventChain(brokenEvents);
  assert.equal(verification.valid, false, "Chuỗi thiếu sự kiện phải bị đánh dấu không hợp lệ");
  assert.equal(verification.type, "BROKEN_CHAIN");
  assert.equal(verification.firstInvalidSequence, 2, "Phải chỉ ra sự kiện số 2 bị thiếu");
});

test("S-55: Kiểm thử tích hợp ghi nhận audit và cảnh báo với PostgreSQL mock pool", async () => {
  const recordedLogs = [];
  const updatedJobs = [];
  const mockPgPool = {
    connect: async () => ({ release: () => {} }),
    query: async (sql, params) => {
      if (sql.includes("SELECT id FROM lots")) {
        return { rows: [{ id: "LOT-PG-1" }, { id: "LOT-PG-2" }] };
      }
      if (sql.includes("INSERT INTO integrity_audit_logs")) {
        recordedLogs.push({ sql, params });
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE integrity_audit_jobs")) {
        updatedJobs.push({ sql, params });
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const res = await scanLotsInBatches({
    pool: mockPgPool,
    batchSize: 10,
    verifier: async (_pool, lotId) => {
      if (lotId === "LOT-PG-2") {
        return { valid: false, type: "CONTENT_TAMPERED", error: "Mã băm không khớp", firstInvalidSequence: 2 };
      }
      return { valid: true, finalHash: "hash-ok" };
    },
  });

  assert.equal(res.success, true);
  assert.equal(res.totalScanned, 2);
  assert.equal(res.invalidCount, 1);
  assert.equal(res.status, "COMPROMISED");
  assert.equal(recordedLogs.length, 2, "Phải ghi nhật ký chi tiết 2 lô vào integrity_audit_logs");
  assert.equal(updatedJobs.length, 1, "Phải cập nhật trạng thái COMPROMISED vào integrity_audit_jobs");
});

