const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const candidates = [
  path.resolve(__dirname, "../../db/migrations"),
  path.resolve(__dirname, "../db/migrations"),
  path.resolve(__dirname, "../migrations"),
  "/app/db/migrations",
];
const MIGRATIONS_DIR =
  candidates.find((d) => fs.existsSync(d)) ||
  path.resolve(__dirname, "../../db/migrations");
const DOWN_DIR = path.join(MIGRATIONS_DIR, "down");

function getPool() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || "postgres"}:${process.env.POSTGRES_PASSWORD || "postgres"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "agri_trace"}`;
  return new Pool({ connectionString });
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(50) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const tableCheck = await client.query(`
    SELECT to_regclass('public.schema_migrations') as reg;
  `);
  if (!tableCheck.rows[0].reg) {
    return [];
  }
  const res = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version ASC"
  );
  return res.rows.map((r) => r.version);
}

async function runMigrations(direction = "up") {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);

    if (direction === "up") {
      const applied = await getAppliedMigrations(client);
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
        .sort();

      let appliedCount = 0;
      for (const file of files) {
        const version = path.basename(file, ".sql");
        if (!applied.includes(version)) {
          console.log(`[Migration] Applying ${file}...`);
          const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

          await client.query("BEGIN");
          try {
            await client.query(sql);
            await client.query(
              "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
              [version]
            );
            await client.query("COMMIT");
            console.log(`[Migration] Successfully applied ${version}`);
            appliedCount++;
          } catch (err) {
            await client.query("ROLLBACK");
            throw new Error(`Failed to apply migration ${file}: ${err.message}`);
          }
        }
      }
      if (appliedCount === 0) {
        console.log("[Migration] Database is up to date. No new migrations.");
      }
      return { status: "ok", appliedCount };
    } else if (direction === "down") {
      const applied = await getAppliedMigrations(client);
      if (applied.length === 0) {
        console.log("[Migration] No migrations to rollback.");
        return { status: "ok", rolledBack: null };
      }

      const lastVersion = applied[applied.length - 1];
      const downCandidates = [
        path.join(DOWN_DIR, `${lastVersion}.down.sql`),
        path.join(MIGRATIONS_DIR, `${lastVersion}.down.sql`),
      ];

      const downFile = downCandidates.find((f) => fs.existsSync(f));
      if (!downFile) {
        throw new Error(
          `Down migration file for version ${lastVersion} not found in ${DOWN_DIR}`
        );
      }

      console.log(
        `[Migration] Rolling back ${lastVersion} using ${path.basename(downFile)}...`
      );
      const sql = fs.readFileSync(downFile, "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        const checkTable = await client.query(
          "SELECT to_regclass('public.schema_migrations') as reg"
        );
        if (checkTable.rows[0].reg) {
          await client.query(
            "DELETE FROM schema_migrations WHERE version = $1",
            [lastVersion]
          );
        }
        await client.query("COMMIT");
        console.log(`[Migration] Successfully rolled back ${lastVersion}`);
        return { status: "ok", rolledBack: lastVersion };
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Failed to rollback ${lastVersion}: ${err.message}`);
      }
    } else {
      throw new Error(
        `Unknown migration direction: ${direction}. Use 'up' or 'down'.`
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  const direction = process.argv[2] || "up";
  runMigrations(direction)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  runMigrations,
  getPool,
};
