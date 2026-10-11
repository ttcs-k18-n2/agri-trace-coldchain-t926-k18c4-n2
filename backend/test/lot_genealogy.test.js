const test = require("node:test");
const assert = require("node:assert/strict");
const { traceLotDescendants, CycleDetectedError } = require("../src/lot_genealogy");
const { seedS22InMemory } = require("../scripts/seed_s22");

test("traceLotDescendants - Thuật toán duyệt xuôi hậu duệ tách/gộp nhiều tầng (BFS lặp)", async (t) => {
  // Chuẩn bị môi trường dữ liệu in-memory mẫu theo kịch bản S22
  const inMemoryLots = [];
  const inMemoryBatchRelations = [];
  const inMemoryBatchEvents = [];
  const inMemoryOrgs = [];
  const inMemoryProducts = [];
  const inMemoryFarms = [];

  seedS22InMemory({
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryBatchEvents,
    inMemoryOrgs,
    inMemoryProducts,
    inMemoryFarms,
  });

  await t.test("1. Lô gốc L02: Duyệt xuôi đa tầng qua cả tách lô (SPLIT) và gộp lô (MERGE)", async () => {
    // Cây phả hệ từ L02:
    // L02 -> tách ra L05 (SPLIT), L06 (SPLIT) (Distance = 1)
    // L05 gộp với L08 -> tạo L10 (Distance = 2)
    // L06 gộp với L09 -> tạo L11 (Distance = 2)
    const result = await traceLotDescendants({
      pool: null,
      startLotId: "L02",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(result.rootLotId, "L02");
    assert.ok(result.rootLot);
    assert.equal(result.rootLot.id, "L02");
    assert.equal(result.descendantCount, 4);

    const descIds = new Set(result.descendantIds);
    assert.deepEqual(descIds, new Set(["L05", "L06", "L10", "L11"]));

    // Kiểm tra cấu trúc phân tầng (levels)
    assert.equal(result.levels.length, 2);

    // Tầng 1: Lô con trực tiếp (distance = 1) -> L05, L06
    const level1 = result.levels[0];
    assert.equal(level1.distance, 1);
    assert.equal(level1.count, 2);
    const level1Ids = level1.lots.map((l) => l.id);
    assert.ok(level1Ids.includes("L05"));
    assert.ok(level1Ids.includes("L06"));

    // Kiểm tra chi tiết thuộc tính từng lô tầng 1
    const l05 = level1.lots.find((l) => l.id === "L05");
    assert.ok(l05);
    assert.equal(l05.relationType, "SPLIT");
    assert.equal(l05.quantity, 200);
    assert.equal(l05.productName, "Cà chua");
    assert.equal(l05.productUnit, "kg");
    assert.equal(l05.distance, 1);
    assert.deepEqual(l05.path, ["L02", "L05"]);
    assert.ok(l05.organizationName);

    // Tầng 2: Lô cháu (distance = 2) -> L10, L11
    const level2 = result.levels[1];
    assert.equal(level2.distance, 2);
    assert.equal(level2.count, 2);
    const level2Ids = level2.lots.map((l) => l.id);
    assert.ok(level2Ids.includes("L10"));
    assert.ok(level2Ids.includes("L11"));

    // Kiểm tra chi tiết thuộc tính từng lô tầng 2
    const l10 = level2.lots.find((l) => l.id === "L10");
    assert.ok(l10);
    assert.equal(l10.relationType, "MERGE");
    assert.equal(l10.distance, 2);
    assert.deepEqual(l10.path, ["L02", "L05", "L10"]);
  });

  await t.test("2. Multi-source merge: Duyệt xuôi từ L01 và L03 đều dẫn đến lô gộp L07", async () => {
    // L01 + L03 -> gộp thành L07
    const resultFromL01 = await traceLotDescendants({
      pool: null,
      startLotId: "L01",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(resultFromL01.descendantCount, 1);
    assert.equal(resultFromL01.descendantIds[0], "L07");
    assert.equal(resultFromL01.levels.length, 1);
    assert.equal(resultFromL01.levels[0].lots[0].relationType, "MERGE");
    assert.equal(resultFromL01.levels[0].lots[0].quantity, 200);

    const resultFromL03 = await traceLotDescendants({
      pool: null,
      startLotId: "L03",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(resultFromL03.descendantCount, 1);
    assert.equal(resultFromL03.descendantIds[0], "L07");
    assert.equal(resultFromL03.levels[0].lots[0].relationType, "MERGE");
  });

  await t.test("3. Multi-source merge sâu 3 tầng: L04 tách thành L08/L09, sau đó L08 gộp vào L10", async () => {
    // L04 -> Tách L08, L09 (Distance 1)
    // L08 -> Gộp vào L10 (Distance 2)
    // L09 -> Gộp vào L11 (Distance 2)
    const resultFromL04 = await traceLotDescendants({
      pool: null,
      startLotId: "L04",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(resultFromL04.descendantCount, 4);
    assert.deepEqual(new Set(resultFromL04.descendantIds), new Set(["L08", "L09", "L10", "L11"]));
    assert.equal(resultFromL04.levels.length, 2);
    assert.equal(resultFromL04.levels[0].distance, 1);
    assert.equal(resultFromL04.levels[1].distance, 2);
  });

  await t.test("4. Lô lá cuối cùng L10: Không có hậu duệ nào", async () => {
    const result = await traceLotDescendants({
      pool: null,
      startLotId: "L10",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(result.descendantCount, 0);
    assert.equal(result.descendantIds.length, 0);
    assert.equal(result.levels.length, 0);
    assert.equal(result.graph.nodes.length, 1);
    assert.equal(result.graph.nodes[0].id, "L10");
  });

  await t.test("5. Lô độc lập L12: Không có liên kết phân tách hay sáp nhập", async () => {
    const result = await traceLotDescendants({
      pool: null,
      startLotId: "L12",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(result.descendantCount, 0);
    assert.equal(result.descendantIds.length, 0);
    assert.equal(result.levels.length, 0);
  });

  await t.test("6. Đồ thị kim cương (Diamond DAG): A tách B & C, sau đó B & C cùng gộp vào D", async () => {
    // A -> B (SPLIT)
    // A -> C (SPLIT)
    // B -> D (MERGE)
    // C -> D (MERGE)
    const diamondLots = [
      { id: "LOT-A", name: "Lô A Gốc", status: "Đã thu hoạch" },
      { id: "LOT-B", name: "Lô B Nhánh 1", status: "Đã thu hoạch" },
      { id: "LOT-C", name: "Lô C Nhánh 2", status: "Đã thu hoạch" },
      { id: "LOT-D", name: "Lô D Hội tụ", status: "Đã thu hoạch" },
    ];
    const diamondRelations = [
      { parentBatchId: "LOT-A", childBatchId: "LOT-B", relationType: "SPLIT", quantity: 50 },
      { parentBatchId: "LOT-A", childBatchId: "LOT-C", relationType: "SPLIT", quantity: 50 },
      { parentBatchId: "LOT-B", childBatchId: "LOT-D", relationType: "MERGE", quantity: 50 },
      { parentBatchId: "LOT-C", childBatchId: "LOT-D", relationType: "MERGE", quantity: 50 },
    ];

    const result = await traceLotDescendants({
      pool: null,
      startLotId: "LOT-A",
      inMemoryLots: diamondLots,
      inMemoryBatchRelations: diamondRelations,
    });

    // globalVisited đảm bảo D chỉ xuất hiện DUY NHẤT 1 lần trong descendantIds
    assert.equal(result.descendantCount, 3);
    assert.deepEqual(new Set(result.descendantIds), new Set(["LOT-B", "LOT-C", "LOT-D"]));

    // Đồ thị vẫn ghi nhận ĐẦY ĐỦ 4 cạnh: A->B, A->C, B->D, C->D
    assert.equal(result.graph.edges.length, 4);
    assert.ok(result.graph.edges.some((e) => e.source === "LOT-A" && e.target === "LOT-B"));
    assert.ok(result.graph.edges.some((e) => e.source === "LOT-A" && e.target === "LOT-C"));
    assert.ok(result.graph.edges.some((e) => e.source === "LOT-B" && e.target === "LOT-D"));
    assert.ok(result.graph.edges.some((e) => e.source === "LOT-C" && e.target === "LOT-D"));
  });

  await t.test("7. Cycle Detection: Ném lỗi CycleDetectedError khi có chu trình A -> B -> A", async () => {
    const cyclicLots = [
      { id: "LOT-A", name: "A", status: "Active" },
      { id: "LOT-B", name: "B", status: "Active" },
    ];
    const cyclicRelations = [
      { parentBatchId: "LOT-A", childBatchId: "LOT-B", relationType: "SPLIT", quantity: 10 },
      { parentBatchId: "LOT-B", childBatchId: "LOT-A", relationType: "MERGE", quantity: 10 },
    ];

    await assert.rejects(
      async () => {
        await traceLotDescendants({
          pool: null,
          startLotId: "LOT-A",
          inMemoryLots: cyclicLots,
          inMemoryBatchRelations: cyclicRelations,
        });
      },
      (err) => {
        assert.equal(err.name, "CycleDetectedError");
        assert.equal(err.cycleLotId, "LOT-A");
        assert.equal(
          err.message,
          "Phát hiện chu trình phả hệ tại lô LOT-A. Dữ liệu quan hệ cha-con bị lặp vòng."
        );
        return true;
      }
    );
  });

  await t.test("8. Cycle Detection: Ném lỗi CycleDetectedError khi có chu trình tam giác A -> B -> C -> A", async () => {
    const cyclicLots = [
      { id: "L-1", name: "1", status: "Active" },
      { id: "L-2", name: "2", status: "Active" },
      { id: "L-3", name: "3", status: "Active" },
    ];
    const cyclicRelations = [
      { parentBatchId: "L-1", childBatchId: "L-2", relationType: "SPLIT", quantity: 10 },
      { parentBatchId: "L-2", childBatchId: "L-3", relationType: "SPLIT", quantity: 10 },
      { parentBatchId: "L-3", childBatchId: "L-1", relationType: "MERGE", quantity: 10 },
    ];

    await assert.rejects(
      async () => {
        await traceLotDescendants({
          pool: null,
          startLotId: "L-1",
          inMemoryLots: cyclicLots,
          inMemoryBatchRelations: cyclicRelations,
        });
      },
      (err) => {
        assert.equal(err.name, "CycleDetectedError");
        assert.equal(err.cycleLotId, "L-1");
        assert.deepEqual(err.path, ["L-1", "L-2", "L-3", "L-1"]);
        return true;
      }
    );
  });

  await t.test("9. Cycle Detection: Ném lỗi CycleDetectedError khi có tự tham chiếu A -> A", async () => {
    const cyclicLots = [{ id: "L-SELF", name: "Self", status: "Active" }];
    const cyclicRelations = [
      { parentBatchId: "L-SELF", childBatchId: "L-SELF", relationType: "SPLIT", quantity: 10 },
    ];

    await assert.rejects(
      async () => {
        await traceLotDescendants({
          pool: null,
          startLotId: "L-SELF",
          inMemoryLots: cyclicLots,
          inMemoryBatchRelations: cyclicRelations,
        });
      },
      (err) => {
        assert.equal(err.name, "CycleDetectedError");
        assert.equal(err.cycleLotId, "L-SELF");
        return true;
      }
    );
  });
});
