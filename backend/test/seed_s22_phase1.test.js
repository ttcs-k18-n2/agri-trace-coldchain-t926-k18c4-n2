const test = require("node:test");
const assert = require("node:assert/strict");
const {
  seedS22Data,
  seedS22InMemory,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  inMemoryOrgs,
  inMemoryProducts,
  inMemoryFarms,
} = require("../src/server");
const { verifyBatchEventChain } = require("../src/event_repository");

test("S-22 Giai đoạn 1: Chuẩn bị dữ liệu mẫu và chuẩn hóa Schema (In-Memory Helper)", async (t) => {
  // Nạp dữ liệu qua helper seedS22Data()
  const res = seedS22Data();

  await t.test("AC1: Bộ dữ liệu mẫu có tối thiểu 12 lô qua ba tầng, có tách và gộp, thuộc 3 tổ chức", () => {
    const s22LotIds = ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12"];
    const foundLots = inMemoryLots.filter((l) => s22LotIds.includes(l.id));
    assert.equal(foundLots.length, 12, "Phải có đủ 12 lô mẫu từ L01 đến L12");

    // 3 tổ chức
    const orgIds = new Set(foundLots.map((l) => l.organizationId || l.organization_id));
    assert.ok(orgIds.has("ORG-A"), "Có tổ chức ORG-A");
    assert.ok(orgIds.has("ORG-B"), "Có tổ chức ORG-B");
    assert.ok(orgIds.has("ORG-C"), "Có tổ chức ORG-C");
    assert.equal(orgIds.size, 3, "Có đúng 3 tổ chức");

    // Thửa đất (farms) liên kết
    const farmsA = inMemoryFarms.filter((f) => f.organization_id === "ORG-A" || f.organizationId === "ORG-A");
    const farmsB = inMemoryFarms.filter((f) => f.organization_id === "ORG-B" || f.organizationId === "ORG-B");
    assert.ok(farmsA.length > 0, "Farms liên kết ORG-A");
    assert.ok(farmsB.length > 0, "Farms liên kết ORG-B");

    // Tách và gộp trong batch_relations
    const relTypes = new Set(inMemoryBatchRelations.map((r) => r.relationType || r.relation_type));
    assert.ok(relTypes.has("SPLIT"), "Có quan hệ phân tách SPLIT");
    assert.ok(relTypes.has("MERGE"), "Có quan hệ gộp lô MERGE");

    // Số lượng quan hệ
    const s22Rels = inMemoryBatchRelations.filter((r) => r.id && r.id.startsWith("rel-s22-"));
    assert.equal(s22Rels.length, 10, "Có đúng 10 quan hệ tách/gộp (rel-s22-01 đến rel-s22-10)");
  });

  await t.test("AC2: Tính Idempotent - Nạp lại nhiều lần không nhân đôi bản ghi hay gây lỗi", () => {
    const countLotsBefore = inMemoryLots.filter((l) => l.id.startsWith("L")).length;
    const countRelsBefore = inMemoryBatchRelations.filter((r) => r.id && r.id.startsWith("rel-s22-")).length;
    const countEventsBefore = inMemoryBatchEvents.filter((e) => e.id && e.id.startsWith("evt-s22-")).length;

    // Chạy lại seed lần 2 và lần 3
    seedS22Data();
    seedS22Data();

    const countLotsAfter = inMemoryLots.filter((l) => l.id.startsWith("L")).length;
    const countRelsAfter = inMemoryBatchRelations.filter((r) => r.id && r.id.startsWith("rel-s22-")).length;
    const countEventsAfter = inMemoryBatchEvents.filter((e) => e.id && e.id.startsWith("evt-s22-")).length;

    assert.equal(countLotsAfter, countLotsBefore, "Số lượng lô không đổi khi seed lại");
    assert.equal(countRelsAfter, countRelsBefore, "Số lượng quan hệ không đổi khi seed lại");
    assert.equal(countEventsAfter, countEventsBefore, "Số lượng sự kiện không đổi khi seed lại");
  });

  await t.test("Độc lập môi trường: Hỗ trợ nạp vào đối tượng container biệt lập (custom target)", () => {
    const customTarget = {
      inMemoryLots: [],
      inMemoryBatchRelations: [],
      inMemoryBatchEvents: [],
      inMemoryOrgs: [],
      inMemoryProducts: [],
      inMemoryFarms: [],
    };

    seedS22InMemory(customTarget);

    assert.equal(customTarget.inMemoryLots.length, 12, "Target độc lập có 12 lô");
    assert.equal(customTarget.inMemoryBatchRelations.length, 10, "Target độc lập có 10 quan hệ");
    assert.equal(customTarget.inMemoryOrgs.length, 3, "Target độc lập có 3 tổ chức");
    assert.equal(customTarget.inMemoryBatchEvents.length, 22, "Target độc lập có 22 sự kiện mật mã");
  });

  await t.test("Toàn vẹn mật mã: 100% chuỗi sự kiện của 12 lô hàng đều hợp lệ SHA-256", () => {
    const s22LotIds = ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12"];
    for (const lotId of s22LotIds) {
      const lotEvents = inMemoryBatchEvents.filter((e) => e.batchId === lotId || e.batch_id === lotId);
      assert.ok(lotEvents.length > 0, `Lô ${lotId} phải có sự kiện`);
      const check = verifyBatchEventChain(lotEvents);
      assert.equal(check.valid, true, `Chuỗi sự kiện của ${lotId} phải hợp lệ, lỗi: ${check.error}`);
    }
  });
});
