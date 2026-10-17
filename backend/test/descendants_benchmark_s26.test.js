const test = require("node:test");
const assert = require("node:assert/strict");
const { traceLotDescendants } = require("../src/lot_genealogy");

/**
 * Sinh mạng lưới đồ thị giả lập 1,000 lô hàng qua 5-10 tầng tách và gộp
 * Cấu trúc:
 * - Tầng 0: 1 lô gốc (LOT-ROOT)
 * - Tầng 1 đến 8: Mỗi tầng chứa ~120 - 150 lô, vừa có tách (SPLIT), vừa có gộp (MERGE)
 * - Tổng cộng: Đạt 1,000 lô và hơn 1,200 quan hệ liên kết
 */
function generateLargeGenealogyGraph(totalLotsTarget = 1000, targetLevels = 8) {
  const lots = [];
  const batchRelations = [];
  const orgs = [
    { id: "ORG-FARM-1", name: "Trang trại A" },
    { id: "ORG-COOP-2", name: "Hợp tác xã B" },
    { id: "ORG-DIST-3", name: "Nhà phân phối C" },
    { id: "ORG-RETAIL-4", name: "Chuỗi siêu thị D" },
  ];

  // Lô gốc Tầng 0
  lots.push({
    id: "LOT-BENCH-ROOT",
    name: "Lô Gốc Benchmark 1000",
    status: "Đã thu hoạch",
    organizationId: orgs[0].id,
    productId: "PROD-VEG",
    initialQuantity: 10000,
    remainingQuantity: 500,
    harvestedAt: "2026-10-01",
    createdAt: "2026-10-01T08:00:00.000Z",
  });

  let currentTierLots = ["LOT-BENCH-ROOT"];
  let createdCount = 1;
  const lotsPerTier = Math.floor((totalLotsTarget - 1) / targetLevels);

  for (let tier = 1; tier <= targetLevels; tier++) {
    const nextTierLots = [];
    const countThisTier = tier === targetLevels
      ? totalLotsTarget - createdCount
      : lotsPerTier;

    for (let i = 0; i < countThisTier; i++) {
      createdCount++;
      const lotId = `LOT-BENCH-T${tier}-${i + 1}`;
      const org = orgs[tier % orgs.length];

      lots.push({
        id: lotId,
        name: `Lô Hậu Duệ T${tier} #${i + 1}`,
        status: tier === targetLevels ? "Đang lưu kho" : "Đã chế biến",
        organizationId: org.id,
        productId: "PROD-VEG",
        initialQuantity: 50,
        remainingQuantity: 25,
        harvestedAt: "2026-10-02",
        createdAt: "2026-10-02T08:00:00.000Z",
      });

      nextTierLots.push(lotId);

      // Phân bổ quan hệ từ tầng trước:
      // Luân phiên giữa SPLIT (1 cha -> 1 con) và MERGE (2 cha -> 1 con)
      const primaryParent = currentTierLots[i % currentTierLots.length];
      const isMerge = i % 3 === 0 && currentTierLots.length > 1;

      batchRelations.push({
        id: `rel-bench-${tier}-${i}-1`,
        parentBatchId: primaryParent,
        childBatchId: lotId,
        relationType: isMerge ? "MERGE" : "SPLIT",
        quantity: 25,
        organizationId: org.id,
      });

      if (isMerge) {
        const secondaryParent = currentTierLots[(i + 1) % currentTierLots.length];
        if (secondaryParent !== primaryParent) {
          batchRelations.push({
            id: `rel-bench-${tier}-${i}-2`,
            parentBatchId: secondaryParent,
            childBatchId: lotId,
            relationType: "MERGE",
            quantity: 25,
            organizationId: org.id,
          });
        }
      }
    }

    currentTierLots = nextTierLots;
  }

  return { lots, batchRelations, orgs };
}

test("S-26 Benchmark: Hiệu năng duyệt xuôi NFR trên 1,000 lô qua 5-10 tầng", async (t) => {
  const TOTAL_LOTS = 1000;
  const LEVELS = 8;

  const { lots, batchRelations, orgs } = generateLargeGenealogyGraph(TOTAL_LOTS, LEVELS);

  assert.equal(lots.length, TOTAL_LOTS, `Đã sinh đúng ${TOTAL_LOTS} lô`);
  assert.ok(batchRelations.length >= 999, `Có ${batchRelations.length} quan hệ batch_relations`);

  await t.test(`Benchmark traceLotDescendants trên ${TOTAL_LOTS} lô (NFR < 2000ms)`, async () => {
    const t0 = performance.now();

    const result = await traceLotDescendants({
      pool: null,
      startLotId: "LOT-BENCH-ROOT",
      inMemoryLots: lots,
      inMemoryBatchRelations: batchRelations,
      inMemoryOrgs: orgs,
    });

    const elapsed = performance.now() - t0;

    console.log(`\n[BENCHMARK NFR] Truy xuôi ${result.descendantCount} lô hậu duệ qua ${result.levels.length} tầng: ${elapsed.toFixed(2)}ms`);

    // Khẳng định dữ liệu
    assert.equal(result.rootLotId, "LOT-BENCH-ROOT");
    assert.equal(result.descendantCount, TOTAL_LOTS - 1, `Phải truy xuôi được đúng ${TOTAL_LOTS - 1} lô hậu duệ`);
    assert.equal(result.levels.length, LEVELS, `Phải phân bổ đúng qua ${LEVELS} tầng`);
    assert.ok(result.graph.nodes.length >= TOTAL_LOTS);
    assert.ok(result.graph.edges.length >= batchRelations.length);

    // Tiêu chí NFR: Khẳng định thời gian hoàn thành dưới 2 giây (< 2000ms)
    assert.ok(
      elapsed < 2000,
      `NFR Violation: Thời gian chạy ${elapsed.toFixed(2)}ms vượt quá ngưỡng 2000ms`
    );

    // Tiêu chí NFR nâng cao: Hệ thống tối ưu thường chạy dưới 200ms
    assert.ok(
      elapsed < 500,
      `Cảnh báo hiệu năng: Thời gian chạy ${elapsed.toFixed(2)}ms vượt ngưỡng tối ưu 500ms`
    );
  });

  await t.test("Benchmark traceLotDescendants trên CSDL PostgreSQL thật (1,000 lô, NFR < 2000ms)", async (subT) => {
    const { Pool } = require("pg");
    const dbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";
    const isStrict = Boolean(
      process.env.CI === "true" ||
      process.env.CI === "1" ||
      process.env.STRICT_BENCHMARK === "true" ||
      process.env.REQUIRE_POSTGRES_BENCHMARK === "true"
    );

    let pool = null;
    try {
      pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
      await pool.query("SELECT 1");
    } catch (connErr) {
      if (isStrict) {
        assert.fail(`[CI/NGHIỆM THU BẮT BUỘC] Không thể kết nối PostgreSQL để chạy Benchmark nghiệm thu S-26: ${connErr.message}`);
      }
      console.log(`[SKIP] PostgreSQL không khả dụng ở local (${connErr.message}), bỏ qua benchmark PostgreSQL thật.`);
      subT.skip("PostgreSQL không khả dụng ở môi trường local.");
      return;
    }

    try {
      await pool.query(`
        INSERT INTO organizations (id, name, type)
        VALUES ('ORG-BENCH-1', 'Bench Org 1', 'producer')
        ON CONFLICT (id) DO NOTHING;
      `);

      await pool.query("DELETE FROM batch_relations WHERE parent_batch_id LIKE 'LOT-PG-BENCH-%' OR child_batch_id LIKE 'LOT-PG-BENCH-%'");
      await pool.query("DELETE FROM lots WHERE id LIKE 'LOT-PG-BENCH-%'");

      const pgGraph = generateLargeGenealogyGraph(TOTAL_LOTS, LEVELS);
      const rootId = "LOT-PG-BENCH-ROOT";

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < pgGraph.lots.length; i += 100) {
          const chunk = pgGraph.lots.slice(i, i + 100);
          const values = [];
          const params = [];
          let idx = 1;
          for (const l of chunk) {
            const lotId = l.id.replace("LOT-BENCH-", "LOT-PG-BENCH-");
            values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
            params.push(lotId, l.name, l.status, "ORG-BENCH-1", l.initialQuantity, l.remainingQuantity);
            idx += 6;
          }
          await client.query(`
            INSERT INTO lots (id, name, status, organization_id, initial_quantity, remaining_quantity)
            VALUES ${values.join(", ")}
          `, params);
        }

        for (let i = 0; i < pgGraph.batchRelations.length; i += 100) {
          const chunk = pgGraph.batchRelations.slice(i, i + 100);
          const values = [];
          const params = [];
          let idx = 1;
          for (const r of chunk) {
            const pId = r.parentBatchId.replace("LOT-BENCH-", "LOT-PG-BENCH-");
            const cId = r.childBatchId.replace("LOT-BENCH-", "LOT-PG-BENCH-");
            values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
            params.push(`rel-pg-${r.id}`, pId, cId, r.relationType, r.quantity, "ORG-BENCH-1");
            idx += 6;
          }
          await client.query(`
            INSERT INTO batch_relations (id, parent_batch_id, child_batch_id, relation_type, quantity, organization_id)
            VALUES ${values.join(", ")}
          `, params);
        }
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // ĐO THỜI GIAN TRUY VẤN POSTGRESQL THẬT
      const t0 = performance.now();
      const result = await traceLotDescendants({
        pool,
        startLotId: rootId,
      });
      const elapsed = performance.now() - t0;

      console.log(`\n[BENCHMARK POSTGRESQL THỰC] Truy xuôi ${result.descendantCount} lô hậu duệ qua ${result.levels.length} tầng trên PostgreSQL: ${elapsed.toFixed(2)}ms`);

      assert.equal(result.rootLotId, rootId);
      assert.equal(result.descendantCount, TOTAL_LOTS - 1);
      assert.equal(result.levels.length, LEVELS);
      const isCoverageMode = process.execArgv.some((a) => a.includes("coverage"));
      const thresholdMs = isCoverageMode ? 3500 : 2000;
      assert.ok(
        elapsed < thresholdMs,
        `NFR Violation trên PostgreSQL thật: Thời gian chạy ${elapsed.toFixed(2)}ms vượt quá ngưỡng ${thresholdMs}ms`
      );
    } finally {
      try {
        await pool.query("DELETE FROM batch_relations WHERE parent_batch_id LIKE 'LOT-PG-BENCH-%' OR child_batch_id LIKE 'LOT-PG-BENCH-%'");
        await pool.query("DELETE FROM lots WHERE id LIKE 'LOT-PG-BENCH-%'");
      } catch (cleanupErr) {
        console.warn("[CLEANUP WARN]", cleanupErr.message);
      }
      await pool.end();
    }
  });

  await t.test("Kiểm tra 3-Color DFS: Phát hiện chu trình trên nhánh hội tụ kim cương (Diamond Graph)", async () => {
    const testLots = [
      { id: "ROOT", name: "Gốc", status: "Đã thu hoạch" },
      { id: "A", name: "Nhánh A", status: "Đã thu hoạch" },
      { id: "B", name: "Nhánh B", status: "Đã thu hoạch" },
      { id: "D", name: "Hội tụ D", status: "Đã thu hoạch" },
    ];
    const testRelations = [
      { parentBatchId: "ROOT", childBatchId: "A", relationType: "SPLIT" },
      { parentBatchId: "ROOT", childBatchId: "B", relationType: "SPLIT" },
      { parentBatchId: "A", childBatchId: "D", relationType: "SPLIT" },
      { parentBatchId: "B", childBatchId: "D", relationType: "SPLIT" },
      { parentBatchId: "D", childBatchId: "B", relationType: "MERGE" },
    ];

    await assert.rejects(
      async () => {
        await traceLotDescendants({
          pool: null,
          startLotId: "ROOT",
          inMemoryLots: testLots,
          inMemoryBatchRelations: testRelations,
        });
      },
      (err) => {
        assert.equal(err.name, "CycleDetectedError");
        return true;
      },
      "Thuật toán 3-Color DFS phải phát hiện được chu trình trên nhánh hội tụ kim cương"
    );
  });
});
