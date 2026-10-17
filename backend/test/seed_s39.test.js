const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  inMemoryOrgs,
  inMemoryProducts,
  inMemoryFarms,
  traceLotDescendants,
  collectDescendantLotIds,
  seedS39Data,
  seedS39InMemory,
} = require("../src/server");
const { verifyBatchEventChain } = require("../src/integrity_verifier");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

const eqSet = (as, bs) => as.size === bs.size && [...as].every((x) => bs.has(x));

test("S-39: Bộ dữ liệu thu hồi mẫu bốn tầng, ba tổ chức, có đáp án đếm tay (Test Matrix TM-01..TM-08 & Idempotency)", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Thiết lập tài khoản test cho tổ chức admin / inspector
  users.set("inspector_s39@gov.vn", {
    id: "usr-insp-s39",
    email: "inspector_s39@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("admin_s39@agri.vn", {
    id: "usr-admin-s39",
    email: "admin_s39@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "admin",
  });

  // AC1: Nạp bộ dữ liệu mẫu S-39
  seedS39Data();

  await t.test("AC1: Bộ dữ liệu mẫu có đồ thị 4 tầng qua 3 tổ chức, có gộp đa nguồn và có lô đã tiêu thụ", () => {
    const s39LotIds = [
      "R01", "R02", "R03", "R04", "R05",
      "R06", "R07", "R08", "R09", "R10",
      "R11", "R12", "R13", "R14", "R15",
    ];
    const foundLots = inMemoryLots.filter((l) => s39LotIds.includes(l.id));
    assert.equal(foundLots.length, 15, "Phải có đủ 15 lô mẫu từ R01 đến R15");

    // 1. Kiểm tra 3 tổ chức
    const orgIds = new Set(foundLots.map((l) => l.organizationId || l.organization_id));
    assert.ok(orgIds.has("ORG-A"), "Có tổ chức ORG-A (Hợp tác xã)");
    assert.ok(orgIds.has("ORG-B"), "Có tổ chức ORG-B (Nhà máy sơ chế)");
    assert.ok(orgIds.has("ORG-C"), "Có tổ chức ORG-C (Trung tâm phân phối & bán lẻ)");
    assert.equal(orgIds.size, 3, "Có đúng 3 tổ chức");

    // 2. Kiểm tra ít nhất 1 lô gộp từ nhiều nguồn (Multi-source merge)
    const mergeRels = inMemoryBatchRelations.filter(
      (r) => (r.relationType || r.relation_type) === "MERGE" && s39LotIds.includes(r.childBatchId || r.child_batch_id)
    );
    assert.ok(mergeRels.length >= 2, "Có ít nhất 2 quan hệ gộp lô MERGE");

    // Lô R08 gộp từ R04 và R06
    const parentsOfR08 = mergeRels
      .filter((r) => (r.childBatchId || r.child_batch_id) === "R08")
      .map((r) => r.parentBatchId || r.parent_batch_id);
    assert.ok(parentsOfR08.includes("R04") && parentsOfR08.includes("R06"), "Lô R08 gộp đa nguồn từ R04 và R06");

    // Lô R10 gộp từ R06 và R07
    const parentsOfR10 = mergeRels
      .filter((r) => (r.childBatchId || r.child_batch_id) === "R10")
      .map((r) => r.parentBatchId || r.parent_batch_id);
    assert.ok(parentsOfR10.includes("R06") && parentsOfR10.includes("R07"), "Lô R10 gộp đa nguồn từ R06 và R07");

    // 3. Kiểm tra ít nhất 1 lô đã tiêu thụ theo Story S-29
    const consumedLots = foundLots.filter((l) => l.status === "Đã bán hết" || l.status === "Đã tiêu thụ");
    assert.ok(consumedLots.length >= 1, "Phải có ít nhất một lô đã tiêu thụ");
    assert.ok(consumedLots.some((l) => l.id === "R11"), "Lô R11 có trạng thái Đã bán hết");
    assert.ok(consumedLots.some((l) => l.id === "R14"), "Lô R14 có trạng thái Đã bán hết");

    // Kiểm tra ràng buộc S-29: lô đã bán hết thì remainingQuantity bắt buộc phải bằng 0
    for (const cLot of consumedLots) {
      assert.equal(
        Number(cLot.remainingQuantity !== undefined ? cLot.remainingQuantity : cLot.remaining_quantity),
        0,
        `Lô đã tiêu thụ ${cLot.id} phải có khối lượng còn lại bằng 0 (S-29 / Migration 022)`
      );
    }

    // 4. Kiểm tra sự kiện LOT_CONSUMED tồn tại trong chuỗi sự kiện
    const consumedEvents = inMemoryBatchEvents.filter((e) => (e.eventType || e.event_type) === "LOT_CONSUMED");
    assert.ok(consumedEvents.some((e) => (e.batchId || e.batch_id) === "R11"), "Lô R11 có sự kiện LOT_CONSUMED");
    assert.ok(consumedEvents.some((e) => (e.batchId || e.batch_id) === "R14"), "Lô R14 có sự kiện LOT_CONSUMED");
  });

  await t.test("TM-07: Tính Idempotent - Seed lần 2 không tăng số lượng bản ghi hay làm sai lệch dữ liệu", () => {
    const countLotsBefore = inMemoryLots.filter((l) => l.id.startsWith("R")).length;
    const countRelsBefore = inMemoryBatchRelations.filter((r) => r.id.startsWith("rel-s39-")).length;
    const countEventsBefore = inMemoryBatchEvents.filter((e) => e.id.startsWith("evt-s39-")).length;

    // Chạy lại seed lần 2
    seedS39Data();

    const countLotsAfter = inMemoryLots.filter((l) => l.id.startsWith("R")).length;
    const countRelsAfter = inMemoryBatchRelations.filter((r) => r.id.startsWith("rel-s39-")).length;
    const countEventsAfter = inMemoryBatchEvents.filter((e) => e.id.startsWith("evt-s39-")).length;

    assert.equal(countLotsAfter, countLotsBefore, "Số lượng lô không đổi khi seed lại");
    assert.equal(countRelsAfter, countRelsBefore, "Số lượng quan hệ không đổi khi seed lại");
    assert.equal(countEventsAfter, countEventsBefore, "Số lượng sự kiện không đổi khi seed lại");
  });

  await t.test("TM-08: Bảo chứng toàn vẹn mật mã: 100% chuỗi sự kiện của 15 lô hàng hợp lệ SHA-256 (K-01 / S-10)", () => {
    const s39LotIds = [
      "R01", "R02", "R03", "R04", "R05",
      "R06", "R07", "R08", "R09", "R10",
      "R11", "R12", "R13", "R14", "R15",
    ];
    for (const lotId of s39LotIds) {
      const lotEvents = inMemoryBatchEvents.filter((e) => (e.batchId || e.batch_id) === lotId);
      assert.ok(lotEvents.length > 0, `Lô ${lotId} phải có sự kiện`);
      const check = verifyBatchEventChain(lotEvents);
      assert.equal(check.valid, true, `Chuỗi sự kiện của ${lotId} phải hợp lệ, lỗi: ${check.error}`);
    }
  });

  // AC2: Đối chiếu ma trận đếm tay độc lập (Test Matrix TM-01 .. TM-06)
  const lotsMap = new Map();
  for (const l of inMemoryLots) lotsMap.set(l.id, l);

  await t.test("TM-01: Lô gốc R01 - Đáp án đếm tay hậu duệ {R04, R05, R08, R09, R11, R12, R13}, tồn kho thu hồi 730kg, 1 lô đã tiêu thụ", async () => {
    const result = await traceLotDescendants({
      startLotId: "R01",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    const expectedDescendants = new Set(["R04", "R05", "R08", "R09", "R11", "R12", "R13"]);
    assert.equal(
      eqSet(new Set(result.descendantIds), expectedDescendants),
      true,
      `Kỳ vọng hậu duệ R01: ${[...expectedDescendants]}, thực tế: ${result.descendantIds}`
    );
    assert.equal(result.descendantCount, 7, "Tổng số hậu duệ của R01 là 7 lô");

    // Kiểm tra chi tiết khối lượng từng lô khớp bảng đếm tay
    const descMap = new Map(result.descendants.map((d) => [d.id, d]));
    assert.equal(descMap.get("R04").remainingQuantity, 150);
    assert.equal(descMap.get("R05").remainingQuantity, 100);
    assert.equal(descMap.get("R08").remainingQuantity, 100);
    assert.equal(descMap.get("R09").remainingQuantity, 100);
    assert.equal(descMap.get("R11").remainingQuantity, 0);
    assert.equal(descMap.get("R12").remainingQuantity, 200);
    assert.equal(descMap.get("R13").remainingQuantity, 80);

    // Tính tổng khối lượng tồn kho hậu duệ cần thu hồi: 150+100+100+100+200+80 = 730kg
    const totalRemainingQuarantine = result.descendants.reduce(
      (sum, d) => sum + Number(d.remainingQuantity || 0),
      0
    );
    assert.equal(totalRemainingQuarantine, 730, "Tổng khối lượng tồn kho hậu duệ cần thu hồi phải là 730 kg");

    // Lô đã tiêu thụ tới người dùng cuối: R11
    const consumedInDesc = result.descendants.filter((d) => d.status === "Đã bán hết");
    assert.equal(consumedInDesc.length, 1);
    assert.equal(consumedInDesc[0].id, "R11");
  });

  await t.test("TM-02: Lô gốc R02 - Đáp án đếm tay hậu duệ {R06, R08, R10, R11, R12, R14}, tồn kho thu hồi 500kg, 2 lô đã tiêu thụ", async () => {
    const result = await traceLotDescendants({
      startLotId: "R02",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    const expectedDescendants = new Set(["R06", "R08", "R10", "R11", "R12", "R14"]);
    assert.equal(
      eqSet(new Set(result.descendantIds), expectedDescendants),
      true,
      `Kỳ vọng hậu duệ R02: ${[...expectedDescendants]}, thực tế: ${result.descendantIds}`
    );
    assert.equal(result.descendantCount, 6);

    // Kiểm tra chi tiết khối lượng từng lô
    const descMap = new Map(result.descendants.map((d) => [d.id, d]));
    assert.equal(descMap.get("R06").remainingQuantity, 100);
    assert.equal(descMap.get("R08").remainingQuantity, 100);
    assert.equal(descMap.get("R10").remainingQuantity, 100);
    assert.equal(descMap.get("R11").remainingQuantity, 0);
    assert.equal(descMap.get("R12").remainingQuantity, 200);
    assert.equal(descMap.get("R14").remainingQuantity, 0);

    // Tổng tồn kho: 100+100+100+200 = 500kg
    const totalRemainingQuarantine = result.descendants.reduce(
      (sum, d) => sum + Number(d.remainingQuantity || 0),
      0
    );
    assert.equal(totalRemainingQuarantine, 500);

    // 2 lô đã tiêu thụ tới người dùng cuối: R11, R14
    const consumedIds = result.descendants.filter((d) => d.status === "Đã bán hết").map((d) => d.id);
    assert.equal(consumedIds.length, 2);
    assert.ok(consumedIds.includes("R11"));
    assert.ok(consumedIds.includes("R14"));
  });

  await t.test("TM-03: Lô gốc R03 - Đáp án đếm tay hậu duệ {R07, R10, R14}, tồn kho thu hồi 250kg, 1 lô đã tiêu thụ", async () => {
    const result = await traceLotDescendants({
      startLotId: "R03",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    const expectedDescendants = new Set(["R07", "R10", "R14"]);
    assert.equal(eqSet(new Set(result.descendantIds), expectedDescendants), true);
    assert.equal(result.descendantCount, 3);

    const descMap = new Map(result.descendants.map((d) => [d.id, d]));
    assert.equal(descMap.get("R07").remainingQuantity, 150);
    assert.equal(descMap.get("R10").remainingQuantity, 100);
    assert.equal(descMap.get("R14").remainingQuantity, 0);

    const totalRemainingQuarantine = result.descendants.reduce(
      (sum, d) => sum + Number(d.remainingQuantity || 0),
      0
    );
    assert.equal(totalRemainingQuarantine, 250);
  });

  await t.test("TM-04 & TM-05: Lô trung gian Tầng 3 (R08 và R10) truy xuôi hậu duệ", async () => {
    // R08 -> {R11, R12}
    const resR08 = await traceLotDescendants({
      startLotId: "R08",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });
    assert.equal(eqSet(new Set(resR08.descendantIds), new Set(["R11", "R12"])), true);

    // R10 -> {R14}
    const resR10 = await traceLotDescendants({
      startLotId: "R10",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });
    assert.equal(eqSet(new Set(resR10.descendantIds), new Set(["R14"])), true);
  });

  await t.test("TM-06: Lô đối chứng độc lập R15 (Tầng 4) không có hậu duệ nào", async () => {
    const resR15 = await traceLotDescendants({
      startLotId: "R15",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });
    assert.equal(resR15.descendantIds.length, 0);
    assert.equal(resR15.descendantCount, 0);
  });

  // Kiểm tra tích hợp qua HTTP API endpoint GET /api/lots/:id/descendants
  await t.test("API GET /api/lots/:id/descendants trả về đầy đủ hậu duệ và thông tin thu hồi theo S-39", async () => {
    const adminAgent = await loginAs("admin_s39@agri.vn");

    // Tra cứu R01 qua API
    const resR01 = await adminAgent.get("/api/lots/R01/descendants");
    assert.equal(resR01.status, 200);
    assert.equal(resR01.body.lotId, "R01");
    assert.equal(
      eqSet(new Set(resR01.body.descendantIds), new Set(["R04", "R05", "R08", "R09", "R11", "R12", "R13"])),
      true
    );

    // Tra cứu chi tiết lô R11 đã bán hết
    const resR11 = await adminAgent.get("/api/lots/R11");
    assert.equal(resR11.status, 200);
    assert.equal(resR11.body.lot.status, "Đã bán hết");
    assert.equal(resR11.body.lot.remainingQuantity, 0);
  });
});
