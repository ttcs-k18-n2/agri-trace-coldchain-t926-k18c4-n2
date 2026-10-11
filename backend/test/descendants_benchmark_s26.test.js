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
});
