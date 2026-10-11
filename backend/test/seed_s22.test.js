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
  collectAncestorLotIds,
  collectDescendantLotIds,
  seedS22Data,
} = require("../src/server");
const { verifyBatchEventChain } = require("../src/integrity_verifier");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

const eqSet = (as, bs) => as.size === bs.size && [...as].every((x) => bs.has(x));

test("S-22: Bộ dữ liệu mẫu phân hệ ba tầng có đáp án đếm tay (Test Matrix T01-T10 & Idempotency)", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Thiết lập tài khoản test cho tổ chức admin / inspector
  users.set("inspector_s22@gov.vn", {
    id: "usr-insp-s22",
    email: "inspector_s22@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("admin_s22@agri.vn", {
    id: "usr-admin-s22",
    email: "admin_s22@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "admin",
  });

  // AC1: Nạp bộ dữ liệu mẫu S-22
  seedS22Data();

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

    // Tách và gộp trong batch_relations
    const relTypes = new Set(inMemoryBatchRelations.map((r) => r.relationType || r.relation_type));
    assert.ok(relTypes.has("SPLIT"), "Có quan hệ phân tách SPLIT");
    assert.ok(relTypes.has("MERGE"), "Có quan hệ gộp lô MERGE");
  });

  await t.test("AC2 & T08: Tính Idempotent - Seed lần 2 không tăng số lượng bản ghi hay gây lỗi", () => {
    const countLotsBefore = inMemoryLots.filter((l) => l.id.startsWith("L")).length;
    const countRelsBefore = inMemoryBatchRelations.filter((r) => r.id.startsWith("rel-s22-")).length;
    const countEventsBefore = inMemoryBatchEvents.filter((e) => e.id.startsWith("evt-s22-")).length;

    // Chạy lại seed lần 2
    seedS22Data();

    const countLotsAfter = inMemoryLots.filter((l) => l.id.startsWith("L")).length;
    const countRelsAfter = inMemoryBatchRelations.filter((r) => r.id.startsWith("rel-s22-")).length;
    const countEventsAfter = inMemoryBatchEvents.filter((e) => e.id.startsWith("evt-s22-")).length;

    assert.equal(countLotsAfter, countLotsBefore, "Số lượng lô không thay đổi khi seed lại");
    assert.equal(countRelsAfter, countRelsBefore, "Số lượng quan hệ không thay đổi khi seed lại");
    assert.equal(countEventsAfter, countEventsBefore, "Số lượng sự kiện không thay đổi khi seed lại");
  });

  await t.test("Bảo chứng toàn vẹn mật mã: 100% chuỗi sự kiện của 12 lô hàng đều hợp lệ SHA-256", () => {
    const s22LotIds = ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12"];
    for (const lotId of s22LotIds) {
      const lotEvents = inMemoryBatchEvents.filter((e) => e.batchId === lotId || e.batch_id === lotId);
      assert.ok(lotEvents.length > 0, `Lô ${lotId} phải có sự kiện`);
      const check = verifyBatchEventChain(lotEvents);
      assert.equal(check.valid, true, `Chuỗi sự kiện của ${lotId} phải hợp lệ, lỗi: ${check.error}`);
    }
  });

  // AC3, AC4, AC5: Đối chiếu độc lập theo Test Matrix S-22
  const lotsMap = new Map();
  for (const l of inMemoryLots) lotsMap.set(l.id, l);

  await t.test("T01: L01 - descendants độc lập kỳ vọng {L07}", async () => {
    const desc = await collectDescendantLotIds(null, "L01", lotsMap, inMemoryBatchRelations);
    assert.equal(eqSet(desc, new Set(["L07"])), true, `Kỳ vọng {L07}, nhận được: ${[...desc]}`);
  });

  await t.test("T02: L02 - descendants độc lập kỳ vọng {L05, L06, L10, L11}", async () => {
    const desc = await collectDescendantLotIds(null, "L02", lotsMap, inMemoryBatchRelations);
    assert.equal(
      eqSet(desc, new Set(["L05", "L06", "L10", "L11"])),
      true,
      `Kỳ vọng {L05, L06, L10, L11}, nhận được: ${[...desc]}`
    );
  });

  await t.test("T03: L04 - descendants độc lập kỳ vọng {L08, L09, L10, L11}", async () => {
    const desc = await collectDescendantLotIds(null, "L04", lotsMap, inMemoryBatchRelations);
    assert.equal(
      eqSet(desc, new Set(["L08", "L09", "L10", "L11"])),
      true,
      `Kỳ vọng {L08, L09, L10, L11}, nhận được: ${[...desc]}`
    );
  });

  await t.test("T04: L10 - ancestors độc lập kỳ vọng {L05, L08, L02, L04}", async () => {
    const anc = await collectAncestorLotIds(null, "L10", lotsMap, inMemoryBatchRelations);
    assert.equal(
      eqSet(anc, new Set(["L05", "L08", "L02", "L04"])),
      true,
      `Kỳ vọng {L05, L08, L02, L04}, nhận được: ${[...anc]}`
    );
  });

  await t.test("T05: L11 - ancestors độc lập kỳ vọng {L06, L09, L02, L04}", async () => {
    const anc = await collectAncestorLotIds(null, "L11", lotsMap, inMemoryBatchRelations);
    assert.equal(
      eqSet(anc, new Set(["L06", "L09", "L02", "L04"])),
      true,
      `Kỳ vọng {L06, L09, L02, L04}, nhận được: ${[...anc]}`
    );
  });

  await t.test("T06: L12 - ancestors độc lập kỳ vọng {}", async () => {
    const anc = await collectAncestorLotIds(null, "L12", lotsMap, inMemoryBatchRelations);
    assert.equal(anc.size, 0, `L12 độc lập không có tổ tiên, nhận được: ${[...anc]}`);
  });

  await t.test("T07: L12 - descendants độc lập kỳ vọng {}", async () => {
    const desc = await collectDescendantLotIds(null, "L12", lotsMap, inMemoryBatchRelations);
    assert.equal(desc.size, 0, `L12 độc lập không có hậu duệ, nhận được: ${[...desc]}`);
  });

  await t.test("T09: L07 - ancestors độc lập kỳ vọng {L01, L03}", async () => {
    const anc = await collectAncestorLotIds(null, "L07", lotsMap, inMemoryBatchRelations);
    assert.equal(
      eqSet(anc, new Set(["L01", "L03"])),
      true,
      `Kỳ vọng {L01, L03}, nhận được: ${[...anc]}`
    );
  });

  await t.test("T10: L10 - descendants độc lập kỳ vọng {}", async () => {
    const desc = await collectDescendantLotIds(null, "L10", lotsMap, inMemoryBatchRelations);
    assert.equal(desc.size, 0, `L10 là tầng 3 không có hậu duệ, nhận được: ${[...desc]}`);
  });

  // Kiểm tra API endpoint phả hệ GET /api/lots/:id/genealogy (S-21, S-22, S-26, S-27, S-28)
  await t.test("API GET /api/lots/:id/genealogy trả về đầy đủ tổ tiên, hậu duệ và đồ thị phả hệ", async () => {
    const adminAgent = await loginAs("admin_s22@agri.vn");

    // Kiểm tra L10
    const resL10 = await adminAgent.get("/api/lots/L10/genealogy");
    assert.equal(resL10.status, 200);
    assert.equal(resL10.body.lotId, "L10");
    assert.equal(eqSet(new Set(resL10.body.ancestorIds), new Set(["L05", "L08", "L02", "L04"])), true);
    assert.equal(resL10.body.descendantIds.length, 0);
    assert.ok(resL10.body.graph && Array.isArray(resL10.body.graph.nodes));
    assert.ok(resL10.body.graph.nodes.some((n) => n.id === "L10" && n.isCurrent === true));
    assert.ok(resL10.body.graph.nodes.some((n) => n.id === "L05" && n.isAncestor === true));

    // Kiểm tra L02
    const resL02 = await adminAgent.get("/api/lots/L02/genealogy");
    assert.equal(resL02.status, 200);
    assert.equal(resL02.body.lotId, "L02");
    assert.equal(resL02.body.ancestorIds.length, 0);
    assert.equal(eqSet(new Set(resL02.body.descendantIds), new Set(["L05", "L06", "L10", "L11"])), true);

    // Kiểm tra L12 độc lập
    const resL12 = await adminAgent.get("/api/lots/L12/genealogy");
    assert.equal(resL12.status, 200);
    assert.equal(resL12.body.ancestorIds.length, 0);
    assert.equal(resL12.body.descendantIds.length, 0);
    assert.equal(resL12.body.graph.nodes.length, 1);
  });

  // Kiểm tra GET /api/lots/:id hiển thị đúng tất cả các lô mẹ và các lô con
  await t.test("API GET /api/lots/:id trả về đầy đủ parentLots và childLots cho các lô gộp và tách", async () => {
    const adminAgent = await loginAs("admin_s22@agri.vn");

    // L07 gộp từ L01 và L03 -> parentLots phải có cả L01 và L03
    const resL07 = await adminAgent.get("/api/lots/L07");
    assert.equal(resL07.status, 200);
    assert.ok(Array.isArray(resL07.body.lot.parentLots));
    const parentIdsL07 = resL07.body.lot.parentLots.map((p) => p.id);
    assert.ok(parentIdsL07.includes("L01"), "L07 parentLots phải chứa L01");
    assert.ok(parentIdsL07.includes("L03"), "L07 parentLots phải chứa L03");

    // L01 được gộp vào L07 -> childLots của L01 phải có L07
    const resL01 = await adminAgent.get("/api/lots/L01");
    assert.equal(resL01.status, 200);
    assert.ok(Array.isArray(resL01.body.lot.childLots));
    const childIdsL01 = resL01.body.lot.childLots.map((c) => c.id);
    assert.ok(childIdsL01.includes("L07"), "L01 childLots phải chứa L07");

    // L03 được gộp vào L07 -> childLots của L03 phải có L07
    const resL03 = await adminAgent.get("/api/lots/L03");
    assert.equal(resL03.status, 200);
    assert.ok(Array.isArray(resL03.body.lot.childLots));
    const childIdsL03 = resL03.body.lot.childLots.map((c) => c.id);
    assert.ok(childIdsL03.includes("L07"), "L03 childLots phải chứa L07");
  });

  // Kiểm tra API trả về HTTP 422 khi phát hiện chu trình dữ liệu phả hệ
  await t.test("API GET /api/lots/:id/genealogy trả về HTTP 422 khi phát hiện chu trình quan hệ", async () => {
    const adminAgent = await loginAs("admin_s22@agri.vn");
    const { inMemoryBatchRelations } = require("../src/server");

    // Tạo giả lập quan hệ chu trình L10 -> L02 (trong khi L02 là cụ của L10)
    inMemoryBatchRelations.push({
      id: "rel-cycle-test",
      parentBatchId: "L10",
      childBatchId: "L02",
      relationType: "MERGE",
      quantity: 50,
      organizationId: "ORG-C",
    });

    try {
      const res = await adminAgent.get("/api/lots/L02/genealogy");
      assert.equal(res.status, 422);
      assert.equal(res.body.error, "CYCLE_DETECTED");
      assert.equal(
        res.body.message,
        "Phát hiện chu trình phả hệ tại lô L02. Dữ liệu quan hệ cha-con bị lặp vòng."
      );
      assert.equal(res.body.cycleLotId, "L02");
    } finally {
      // Dọn dẹp quan hệ chu trình giả lập
      const idx = inMemoryBatchRelations.findIndex((r) => r.id === "rel-cycle-test");
      if (idx >= 0) inMemoryBatchRelations.splice(idx, 1);
    }
  });
});
