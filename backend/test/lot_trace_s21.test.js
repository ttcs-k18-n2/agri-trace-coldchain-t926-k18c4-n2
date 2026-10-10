const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryFarms,
  seedS22Data,
  clearLotOriginsCache,
} = require("../src/server");
const { traceLotOrigins, CycleDetectedError } = require("../src/lot_genealogy");

const eqSet = (as, bs) => as.size === bs.size && [...as].every((x) => bs.has(x));

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-21 / S-22 / T-51: Bộ kiểm thử tự động toàn diện (CI Automated Tests) cho Truy xuất nguồn gốc", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Thiết lập người dùng các tổ chức cho test phân quyền
  users.set("user_a@org-a.vn", {
    id: "usr-s21-a",
    email: "user_a@org-a.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-A",
    roleId: "cooperative",
  });

  users.set("user_b@org-b.vn", {
    id: "usr-s21-b",
    email: "user_b@org-b.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-B",
    roleId: "producer",
  });

  users.set("user_c@org-c.vn", {
    id: "usr-s21-c",
    email: "user_c@org-c.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-C",
    roleId: "distributor",
  });

  users.set("inspector_ci@gov.vn", {
    id: "usr-s21-insp",
    email: "inspector_ci@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  // Nạp bộ dữ liệu mẫu phả hệ 3 tầng S-22 và xóa cache
  seedS22Data();
  clearLotOriginsCache();

  const options = {
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryFarms,
  };

  /**
   * Test 1 (Đối chiếu bộ dữ liệu mẫu S-22 - AC2):
   * Chạy truy ngược cho các lô mẫu (L10, L11, L07,...) và khẳng định kết quả khớp 100% với đáp án đếm tay độc lập.
   */
  await t.test("Test 1: Đối chiếu bộ dữ liệu mẫu S-22 - Khớp 100% với đáp án đếm tay độc lập", async () => {
    // 1.1 Lô L10 (Gộp từ L05 và L08)
    // Đáp án đếm tay tổ tiên S-22: L10 = {L05, L08, L02, L04}
    const traceL10 = await traceLotOrigins(null, "L10", options);
    assert.equal(
      eqSet(new Set(traceL10.ancestorIds), new Set(["L05", "L08", "L02", "L04"])),
      true,
      "Tổ tiên L10 phải khớp {L05, L08, L02, L04}"
    );
    assert.equal(traceL10.levels.length, 2, "L10 có đúng 2 tầng tổ tiên");
    assert.equal(eqSet(new Set(traceL10.levels[0].lots.map((l) => l.id)), new Set(["L05", "L08"])), true);
    assert.equal(eqSet(new Set(traceL10.levels[1].lots.map((l) => l.id)), new Set(["L02", "L04"])), true);

    // 1.2 Lô L11 (Gộp từ L06 và L09)
    // Đáp án đếm tay tổ tiên S-22: L11 = {L06, L09, L02, L04}
    const traceL11 = await traceLotOrigins(null, "L11", options);
    assert.equal(
      eqSet(new Set(traceL11.ancestorIds), new Set(["L06", "L09", "L02", "L04"])),
      true,
      "Tổ tiên L11 phải khớp {L06, L09, L02, L04}"
    );
    assert.equal(traceL11.levels.length, 2, "L11 có đúng 2 tầng tổ tiên");
    assert.equal(eqSet(new Set(traceL11.levels[0].lots.map((l) => l.id)), new Set(["L06", "L09"])), true);
    assert.equal(eqSet(new Set(traceL11.levels[1].lots.map((l) => l.id)), new Set(["L02", "L04"])), true);

    // 1.3 Lô L07 (Gộp từ L01 và L03)
    // Đáp án đếm tay tổ tiên S-22: L07 = {L01, L03}
    const traceL07 = await traceLotOrigins(null, "L07", options);
    assert.equal(
      eqSet(new Set(traceL07.ancestorIds), new Set(["L01", "L03"])),
      true,
      "Tổ tiên L07 phải khớp {L01, L03}"
    );
    assert.equal(traceL07.levels.length, 1, "L07 có đúng 1 tầng tổ tiên");

    // 1.4 Lô L05 và L06 (Tách từ L02)
    // Đáp án đếm tay tổ tiên S-22: L05 = {L02}, L06 = {L02}
    const traceL05 = await traceLotOrigins(null, "L05", options);
    assert.equal(eqSet(new Set(traceL05.ancestorIds), new Set(["L02"])), true);
    const traceL06 = await traceLotOrigins(null, "L06", options);
    assert.equal(eqSet(new Set(traceL06.ancestorIds), new Set(["L02"])), true);

    // 1.5 Lô L08 và L09 (Tách từ L04)
    // Đáp án đếm tay tổ tiên S-22: L08 = {L04}, L09 = {L04}
    const traceL08 = await traceLotOrigins(null, "L08", options);
    assert.equal(eqSet(new Set(traceL08.ancestorIds), new Set(["L04"])), true);
    const traceL09 = await traceLotOrigins(null, "L09", options);
    assert.equal(eqSet(new Set(traceL09.ancestorIds), new Set(["L04"])), true);

    // 1.6 Lô L12 (Lô độc lập)
    // Đáp án đếm tay tổ tiên S-22: L12 = {}
    const traceL12 = await traceLotOrigins(null, "L12", options);
    assert.equal(traceL12.ancestorIds.length, 0, "L12 không có tổ tiên");
    assert.equal(traceL12.levels.length, 0);
  });

  /**
   * Test 2 (Lô gộp từ 2 vùng trồng - AC1):
   * Kiểm tra lô gộp trả về đúng 2 lô thu hoạch gốc kèm tên nông trại và thửa đất.
   */
  await t.test("Test 2: Lô gộp từ 2 vùng trồng (AC1) - Trả về đúng 2 lô gốc kèm thông tin vùng trồng và thửa đất", async () => {
    const traceL10 = await traceLotOrigins(null, "L10", options);

    // L10 gộp từ L05 (nguồn L02 thuộc FARM-ORG-A) và L08 (nguồn L04 thuộc FARM-ORG-B)
    assert.equal(traceL10.rootLots.length, 2, "L10 phải có đúng 2 lô thu hoạch gốc");
    const rootLotIds = traceL10.rootLots.map((r) => r.id);
    assert.ok(rootLotIds.includes("L02"), "Phải có lô gốc L02");
    assert.ok(rootLotIds.includes("L04"), "Phải có lô gốc L04");

    const rootL02 = traceL10.rootLots.find((r) => r.id === "L02");
    assert.ok(rootL02.farm, "L02 phải có thông tin vùng trồng/thửa đất");
    assert.equal(rootL02.farm.name, "Thửa canh tác Hợp tác xã A");
    assert.equal(rootL02.farm.area, 3.5);
    assert.equal(rootL02.farm.coordinates, "21.5645, 105.6789");

    const rootL04 = traceL10.rootLots.find((r) => r.id === "L04");
    assert.ok(rootL04.farm, "L04 phải có thông tin vùng trồng/thửa đất");
    assert.equal(rootL04.farm.name, "Thửa sơ chế Nhà máy B");
    assert.equal(rootL04.farm.area, 2.0);
    assert.equal(rootL04.farm.coordinates, "21.5712, 105.6841");
  });

  /**
   * Test 3 (Lô đơn F0 chưa từng tách/gộp - AC3):
   * Kiểm tra lô F0 trả về chính nó là lô gốc, không có tầng tổ tiên trước đó.
   */
  await t.test("Test 3: Lô đơn F0 chưa từng tách/gộp (AC3) - Trả về chính nó là lô gốc, levels rỗng", async () => {
    const traceL01 = await traceLotOrigins(null, "L01", options);

    assert.equal(traceL01.lotId, "L01");
    assert.equal(traceL01.isRoot, true, "L01 phải được đánh dấu là Root Lot");
    assert.equal(traceL01.levels.length, 0, "L01 không có tầng tổ tiên nào trước đó");
    assert.equal(traceL01.totalAncestors, 0, "L01 không có tổ tiên");
    assert.equal(traceL01.rootLots.length, 1);
    assert.equal(traceL01.rootLots[0].id, "L01", "Chính nó là lô gốc duy nhất");
    assert.ok(traceL01.rootLots[0].farm);
    assert.equal(traceL01.rootLots[0].farm.name, "Thửa canh tác Hợp tác xã A");
  });

  /**
   * Test 4 (Phát hiện chu trình cố ý - AC4 / T-51):
   * Chèn quan hệ tuần hoàn (ví dụ A -> B -> C -> A) và khẳng định hàm dừng lại, ném đúng lỗi kèm mã lô gây chu trình.
   */
  await t.test("Test 4: Phát hiện chu trình cố ý (AC4 / T-51) - Ném CycleDetectedError kèm mã lô gây chu trình", async () => {
    const cyclicLots = [
      { id: "LOT-CYCLE-A", name: "Lô chu trình A", parentLotId: "LOT-CYCLE-B" },
      { id: "LOT-CYCLE-B", name: "Lô chu trình B", parentLotId: "LOT-CYCLE-C" },
      { id: "LOT-CYCLE-C", name: "Lô chu trình C", parentLotId: "LOT-CYCLE-A" },
    ];
    const cyclicRels = [
      { id: "rel-c1", parentBatchId: "LOT-CYCLE-B", childBatchId: "LOT-CYCLE-A", relationType: "SPLIT" },
      { id: "rel-c2", parentBatchId: "LOT-CYCLE-C", childBatchId: "LOT-CYCLE-B", relationType: "SPLIT" },
      { id: "rel-c3", parentBatchId: "LOT-CYCLE-A", childBatchId: "LOT-CYCLE-C", relationType: "SPLIT" },
    ];

    await assert.rejects(
      async () => {
        await traceLotOrigins(null, "LOT-CYCLE-A", {
          inMemoryLots: cyclicLots,
          inMemoryBatchRelations: cyclicRels,
        });
      },
      (err) => {
        assert.ok(err instanceof CycleDetectedError, "Lỗi phải là thể hiện của CycleDetectedError");
        assert.equal(err.name, "CycleDetectedError");
        assert.equal(err.cycleLotId, "LOT-CYCLE-A", "Mã lô gây chu trình phải là LOT-CYCLE-A");
        assert.match(err.message, /Phát hiện chu trình cha–con tại lô LOT-CYCLE-A/);
        return true;
      }
    );
  });

  /**
   * Test 5 (Phân quyền 403 - T-50):
   * Khẳng định tổ chức không liên quan khi gọi endpoint bị từ chối với HTTP 403.
   */
  await t.test("Test 5: Phân quyền 403 (T-50) - Chặn tổ chức không liên quan với HTTP 403", async () => {
    // Tạo 1 lô riêng biệt cho ORG-A không liên quan đến ORG-C
    const secretLotId = "LOT-ISOLATED-ORG-A";
    inMemoryLots.push({
      id: secretLotId,
      name: "Lô Biệt Lập Hợp Tác Xã A",
      status: "Đã thu hoạch",
      organizationId: "ORG-A",
      parentLotId: null,
      productId: "PROD-TOMATO",
      farmId: "FARM-ORG-A",
      initialQuantity: 100,
      remainingQuantity: 100,
    });

    const userBAgent = await loginAs("user_b@org-b.vn");

    // ORG-B không sở hữu và không phải hạ nguồn của LOT-ISOLATED-ORG-A
    const res = await userBAgent.get(`/api/lots/${secretLotId}/origins`);
    assert.equal(res.status, 403, "Phải trả về 403 Forbidden");
    assert.match(res.body.message, /bị từ chối/i);
  });

  /**
   * Test 6 (Bộ nhớ đệm Cache 60s - T-50 NFR):
   * Khẳng định request thứ 2 trong 60s được lấy từ cache.
   */
  await t.test("Test 6: Bộ nhớ đệm Cache 60s (T-50 NFR) - Request thứ 2 trong 60s được lấy từ cache", async () => {
    clearLotOriginsCache("L10");
    const userCAgent = await loginAs("user_c@org-c.vn");

    // Lần 1: Không lấy từ cache
    const res1 = await userCAgent.get("/api/lots/L10/origins");
    assert.equal(res1.status, 200);
    assert.equal(res1.body.cached, false, "Lần đầu không được lấy từ cache");

    // Lần 2: Lấy từ cache
    const res2 = await userCAgent.get("/api/lots/L10/origins");
    assert.equal(res2.status, 200);
    assert.equal(res2.body.cached, true, "Lần thứ 2 phải được lấy từ cache");
    assert.ok(res2.body.cachedAt, "Phải có thời điểm cachedAt");
    assert.equal(res2.body.lotId, "L10");
    assert.equal(res2.body.totalAncestors, res1.body.totalAncestors);
  });

  /**
   * Test 7 (NFR Hiệu năng):
   * Kiểm thử BFS trên đồ thị 1000 nút hoàn thành trong < 2 giây và không dùng đệ quy.
   */
  await t.test("Test 7: NFR Hiệu năng - BFS trên đồ thị 1000 nút hoàn thành trong < 2 giây và không dùng đệ quy", async () => {
    const bigLots = [];
    const bigRels = [];
    const CHAIN_SIZE = 1000;

    for (let i = 1; i <= CHAIN_SIZE; i++) {
      const parentId = i > 1 ? `LOT-PERF-${i - 1}` : null;
      bigLots.push({
        id: `LOT-PERF-${i}`,
        name: `Lô Hiệu Năng ${i}`,
        parentLotId: parentId,
        farmId: i === 1 ? "FARM-ORG-A" : null,
        organizationId: "ORG-A",
      });
      if (parentId) {
        bigRels.push({
          id: `rel-perf-${i}`,
          parentBatchId: parentId,
          childBatchId: `LOT-PERF-${i}`,
          relationType: "SPLIT",
          quantity: 10,
        });
      }
    }

    const tStart = performance.now();
    const result = await traceLotOrigins(null, `LOT-PERF-${CHAIN_SIZE}`, {
      inMemoryLots: bigLots,
      inMemoryBatchRelations: bigRels,
      inMemoryFarms,
    });
    const tEnd = performance.now();
    const elapsedMs = tEnd - tStart;

    assert.equal(result.totalAncestors, CHAIN_SIZE - 1, "Tổng số tổ tiên phải là 999");
    assert.equal(result.levels.length, CHAIN_SIZE - 1, "Số tầng phân cấp phải là 999");
    assert.equal(result.rootLots.length, 1);
    assert.equal(result.rootLots[0].id, "LOT-PERF-1");
    assert.ok(
      elapsedMs < 2000,
      `Thời gian thực thi BFS phải strictly < 2000ms (2 giây), thực tế: ${elapsedMs.toFixed(2)}ms`
    );
  });
});
