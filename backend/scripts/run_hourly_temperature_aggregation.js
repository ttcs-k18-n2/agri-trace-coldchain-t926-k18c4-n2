#!/usr/bin/env node
/**
 * CLI Runner: Job Tổng Hợp Dữ Liệu Nhiệt Độ Cũ Theo Giờ (Story S-51 / Jira N2-114 / Subtask N2-303)
 *
 * Cách dùng:
 *   node backend/scripts/run_hourly_temperature_aggregation.js
 *   node backend/scripts/run_hourly_temperature_aggregation.js --days=30
 */

const { Pool } = require("pg");
const {
  runTemperatureHourlyAggregationJob,
  DEFAULT_CUTOFF_DAYS,
} = require("../src/temperature_hourly_aggregation_service");

async function main() {
  const args = process.argv.slice(2);
  let cutoffDays = DEFAULT_CUTOFF_DAYS;

  for (const arg of args) {
    if (arg.startsWith("--days=")) {
      const parsed = parseInt(arg.split("=")[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        cutoffDays = parsed;
      }
    }
  }

  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://agri_app:app_password@localhost:5432/agri_trace";

  const pool = new Pool({ connectionString });

  try {
    console.log(`[Nightly Temperature Aggregation] Bắt đầu tổng hợp dữ liệu cũ hơn ${cutoffDays} ngày...`);
    const result = await runTemperatureHourlyAggregationJob({
      pool,
      cutoffDays,
      now: new Date(),
    });

    console.log("[Nightly Temperature Aggregation] Hoàn thành xuất sắc:", {
      jobId: result.jobId,
      rawRowsScanned: result.rawRowsScanned,
      aggregatedRowsCount: result.aggregatedRowsCount,
      retainedViolationRowsCount: result.retainedViolationRowsCount,
      durationMs: result.durationMs,
    });
    process.exit(0);
  } catch (err) {
    console.error("[Nightly Temperature Aggregation] Lỗi nghiêm trọng:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
