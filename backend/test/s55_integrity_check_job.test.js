const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_BATCH_SIZE,
  scanLotsInBatches,
  runIntegrityCheck,
  initIntegrityCheckJob,
} = require("../src/jobs/integrityCheckJob");

test("S-55: Cấu hình mặc định đúng lịch 2:00 sáng và LIMIT 100", () => {
  assert.equal(DEFAULT_CRON_SCHEDULE, "0 2 * * *", "Lịch cron mặc định phải là 2:00 AM hàng ngày");
  assert.equal(DEFAULT_BATCH_SIZE, 100, "LIMIT mặc định mỗi đợt quét phải là 100");
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
