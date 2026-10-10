const test = require("node:test");
const assert = require("node:assert/strict");
const {
  seedS22Data,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryFarms,
} = require("../src/server");
const { traceLotOrigins, CycleDetectedError } = require("../src/lot_genealogy");

const eqSet = (as, bs) => as.size === bs.size && [...as].every((x) => bs.has(x));

test("T-49: Thuật toán duyệt ngược BFS phân tầng & phát hiện chu trình (traceLotOrigins)", async (t) => {
  // Nạp dữ liệu mẫu S-22
  seedS22Data();

  const options = {
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryFarms,
  };

  await t.test("AC1 & AC4: Duyệt ngược lô L10 (Gộp từ L05 và L08) có đúng 2 tầng tổ tiên {L05, L08} và {L02, L04}", async () => {
    const result = await traceLotOrigins(null, "L10", options);

    assert.equal(result.lotId, "L10");
    assert.equal(result.isRoot, false);
    assert.equal(result.totalAncestors, 4);

    // Kiểm tra tập ID tổ tiên khớp đúng đáp án đếm tay độc lập S-22
    const expectedAncestors = new Set(["L05", "L08", "L02", "L04"]);
    assert.equal(eqSet(new Set(result.ancestorIds), expectedAncestors), true);

    // Kiểm tra phân tầng (levels)
    assert.equal(result.levels.length, 2, "Có 2 tầng tổ tiên");

    // Tầng 1: L05, L08
    assert.equal(result.levels[0].level, 1);
    const level1Ids = new Set(result.levels[0].lots.map((l) => l.id));
    assert.equal(eqSet(level1Ids, new Set(["L05", "L08"])), true);

    // Tầng 2: L02, L04
    assert.equal(result.levels[1].level, 2);
    const level2Ids = new Set(result.levels[1].lots.map((l) => l.id));
    assert.equal(eqSet(level2Ids, new Set(["L02", "L04"])), true);

    // Lô gốc tìm được phải là L02 và L04
    const rootIds = new Set(result.rootLots.map((r) => r.id));
    assert.equal(eqSet(rootIds, new Set(["L02", "L04"])), true);

    // Kiểm tra thông tin thửa đất (farm) của lô gốc L02 và L04
    const rootL02 = result.rootLots.find((r) => r.id === "L02");
    assert.ok(rootL02.farm, "L02 phải có thông tin vùng trồng farm");
    assert.equal(rootL02.farm.name, "Thửa canh tác Hợp tác xã A");
    assert.equal(rootL02.farm.area, 3.5);
    assert.equal(rootL02.farm.coordinates, "21.5645, 105.6789");

    const rootL04 = result.rootLots.find((r) => r.id === "L04");
    assert.ok(rootL04.farm, "L04 phải có thông tin vùng trồng farm");
    assert.equal(rootL04.farm.name, "Thửa sơ chế Nhà máy B");
    assert.equal(rootL04.farm.area, 2.0);
  });

  await t.test("AC1: Duyệt ngược lô L11 (Gộp từ L06 và L09) có đúng 2 tầng tổ tiên {L06, L09} và {L02, L04}", async () => {
    const result = await traceLotOrigins(null, "L11", options);

    assert.equal(result.lotId, "L11");
    assert.equal(result.isRoot, false);
    assert.equal(result.totalAncestors, 4);

    const expectedAncestors = new Set(["L06", "L09", "L02", "L04"]);
    assert.equal(eqSet(new Set(result.ancestorIds), expectedAncestors), true);

    assert.equal(result.levels.length, 2);
    const level1Ids = new Set(result.levels[0].lots.map((l) => l.id));
    assert.equal(eqSet(level1Ids, new Set(["L06", "L09"])), true);

    const level2Ids = new Set(result.levels[1].lots.map((l) => l.id));
    assert.equal(eqSet(level2Ids, new Set(["L02", "L04"])), true);

    const rootIds = new Set(result.rootLots.map((r) => r.id));
    assert.equal(eqSet(rootIds, new Set(["L02", "L04"])), true);
  });

  await t.test("AC1: Duyệt ngược lô L07 (Gộp từ L01 và L03) có đúng 1 tầng tổ tiên {L01, L03}", async () => {
    const result = await traceLotOrigins(null, "L07", options);

    assert.equal(result.lotId, "L07");
    assert.equal(result.isRoot, false);
    assert.equal(result.totalAncestors, 2);

    const expectedAncestors = new Set(["L01", "L03"]);
    assert.equal(eqSet(new Set(result.ancestorIds), expectedAncestors), true);

    assert.equal(result.levels.length, 1);
    const level1Ids = new Set(result.levels[0].lots.map((l) => l.id));
    assert.equal(eqSet(level1Ids, new Set(["L01", "L03"])), true);

    const rootIds = new Set(result.rootLots.map((r) => r.id));
    assert.equal(eqSet(rootIds, new Set(["L01", "L03"])), true);
  });

  await t.test("AC1: Duyệt ngược lô L05 (Tách từ L02) có tổ tiên là {L02}", async () => {
    const result = await traceLotOrigins(null, "L05", options);

    assert.equal(result.lotId, "L05");
    assert.equal(result.isRoot, false);
    assert.equal(result.totalAncestors, 1);
    assert.equal(result.ancestorIds[0], "L02");

    assert.equal(result.levels.length, 1);
    assert.equal(result.rootLots.length, 1);
    assert.equal(result.rootLots[0].id, "L02");
  });

  await t.test("AC3: Lô chưa từng tách/gộp (F0) L01 trả về chính nó là lô gốc duy nhất, levels rỗng", async () => {
    const result = await traceLotOrigins(null, "L01", options);

    assert.equal(result.lotId, "L01");
    assert.equal(result.isRoot, true, "L01 là lô gốc F0");
    assert.equal(result.totalAncestors, 0);
    assert.equal(result.levels.length, 0);
    assert.equal(result.rootLots.length, 1);
    assert.equal(result.rootLots[0].id, "L01");
    assert.ok(result.rootLots[0].farm);
    assert.equal(result.rootLots[0].farm.name, "Thửa canh tác Hợp tác xã A");
  });

  await t.test("AC3: Lô độc lập L12 trả về chính nó là lô gốc duy nhất", async () => {
    const result = await traceLotOrigins(null, "L12", options);

    assert.equal(result.lotId, "L12");
    assert.equal(result.isRoot, true, "L12 là lô độc lập F0");
    assert.equal(result.totalAncestors, 0);
    assert.equal(result.levels.length, 0);
    assert.equal(result.rootLots.length, 1);
    assert.equal(result.rootLots[0].id, "L12");
  });

  await t.test("AC4: Phát hiện chu trình (Cycle Detection) - Ném CycleDetectedError kèm mã lô rõ ràng", async () => {
    // Giả lập đồ thị có chu trình: LOT-A -> LOT-B -> LOT-C -> LOT-A
    const cyclicLots = [
      { id: "LOT-CYC-A", name: "Lô A", parentLotId: "LOT-CYC-B" },
      { id: "LOT-CYC-B", name: "Lô B", parentLotId: "LOT-CYC-C" },
      { id: "LOT-CYC-C", name: "Lô C", parentLotId: "LOT-CYC-A" },
    ];
    const cyclicRels = [
      { parentBatchId: "LOT-CYC-B", childBatchId: "LOT-CYC-A" },
      { parentBatchId: "LOT-CYC-C", childBatchId: "LOT-CYC-B" },
      { parentBatchId: "LOT-CYC-A", childBatchId: "LOT-CYC-C" },
    ];

    await assert.rejects(
      async () => {
        await traceLotOrigins(null, "LOT-CYC-A", {
          inMemoryLots: cyclicLots,
          inMemoryBatchRelations: cyclicRels,
        });
      },
      (err) => {
        assert.ok(err instanceof CycleDetectedError, "Phải ném CycleDetectedError");
        assert.match(err.message, /Phát hiện chu trình cha–con tại lô/);
        return true;
      }
    );
  });

  await t.test("NFR Hiệu năng: Đồ thị sâu 1000 nút xử lý < 2 giây", async () => {
    const bigLots = [];
    const bigRels = [];
    const N = 1000;

    for (let i = 1; i <= N; i++) {
      const parentId = i > 1 ? `LOT-CHAIN-${i - 1}` : null;
      bigLots.push({
        id: `LOT-CHAIN-${i}`,
        name: `Lô xích ${i}`,
        parentLotId: parentId,
        farmId: i === 1 ? "FARM-ORG-A" : null,
      });
      if (parentId) {
        bigRels.push({
          id: `rel-${i}`,
          parentBatchId: parentId,
          childBatchId: `LOT-CHAIN-${i}`,
          relationType: "SPLIT",
        });
      }
    }

    const t0 = performance.now();
    const result = await traceLotOrigins(null, `LOT-CHAIN-${N}`, {
      inMemoryLots: bigLots,
      inMemoryBatchRelations: bigRels,
      inMemoryFarms,
    });
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.equal(result.totalAncestors, N - 1);
    assert.equal(result.levels.length, N - 1);
    assert.equal(result.rootLots.length, 1);
    assert.equal(result.rootLots[0].id, "LOT-CHAIN-1");
    assert.ok(duration < 2000, `Thời gian xử lý phải < 2000ms, thực tế: ${duration.toFixed(2)}ms`);
  });
});
