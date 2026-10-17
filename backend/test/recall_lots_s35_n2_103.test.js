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
  inMemoryLocations,
  inMemoryOrgs,
  inMemoryOrganizations,
  inMemoryProducts,
  inMemoryFarms,
} = require("../src/server");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("Story N2-103 [S-35]: Danh sách thu hồi chỉ ra từng lô đang ở đâu, còn bao nhiêu, đã bán bao nhiêu", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  // Cấu hình tài khoản thử nghiệm
  users.set("inspector_n2_103@gov.vn", {
    id: "usr-insp-n2-103",
    email: "inspector_n2_103@gov.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-inspector",
    roleId: "inspector",
  });

  users.set("producer_n2_103@farm.vn", {
    id: "usr-prod-n2-103",
    email: "producer_n2_103@farm.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-PROD-ROOT",
    roleId: "producer",
  });

  users.set("unrelated_n2_103@other.vn", {
    id: "usr-unrelated-n2-103",
    email: "unrelated_n2_103@other.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "ORG-OTHER",
    roleId: "producer",
  });

  users.set("admin_n2_103@agri.vn", {
    id: "usr-admin-n2-103",
    email: "admin_n2_103@agri.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-system",
    roleId: "admin",
  });

  // Thiết lập danh mục tổ chức
  const orgA = { id: "ORG-PROD-ROOT", name: "Hợp tác xã Nông nghiệp Xanh" };
  const orgDist1 = { id: "ORG-DIST-NORTH", name: "Công ty Phân phối Miền Bắc" };
  const orgDist2 = { id: "ORG-DIST-SOUTH", name: "Công ty Phân phối Miền Nam" };
  const orgRetail = { id: "ORG-RETAIL-CHAIN", name: "Chuỗi Siêu thị Tiện lợi FreshMart" };

  for (const org of [orgA, orgDist1, orgDist2, orgRetail]) {
    if (!inMemoryOrgs.some((o) => o.id === org.id)) {
      inMemoryOrgs.push(org);
    }
    if (!inMemoryOrganizations.some((o) => o.id === org.id)) {
      inMemoryOrganizations.push(org);
    }
  }

  // Thiết lập danh mục địa điểm lưu kho / cửa hàng
  const locKho1 = { id: "LOC-WH-HN-01", name: "Tổng kho Lạnh Hà Nội", address: "KCN Quang Minh, Mê Linh, Hà Nội", locationType: "warehouse", organizationId: "ORG-DIST-NORTH" };
  const locKho2 = { id: "LOC-WH-SG-01", name: "Tổng kho Lạnh Sài Gòn", address: "KCX Tân Thuận, Q7, TP.HCM", locationType: "warehouse", organizationId: "ORG-DIST-SOUTH" };
  const locStore1 = { id: "LOC-STORE-D1", name: "FreshMart Cửa hàng Q1", address: "123 Nguyễn Huệ, Q1, TP.HCM", locationType: "retail_store", organizationId: "ORG-RETAIL-CHAIN" };
  const locStore2 = { id: "LOC-STORE-CG", name: "FreshMart Cửa hàng Cầu Giấy", address: "45 Trần Thái Tông, Cầu Giấy, Hà Nội", locationType: "retail_store", organizationId: "ORG-RETAIL-CHAIN" };

  for (const loc of [locKho1, locKho2, locStore1, locStore2]) {
    const idx = inMemoryLocations.findIndex((l) => l.id === loc.id);
    if (idx >= 0) inMemoryLocations[idx] = loc;
    else inMemoryLocations.push(loc);
  }

  // Khởi tạo lô gốc (Root Lot) cần thu hồi
  const rootLotId = "LOT-RECALL-ROOT-2026";
  const childLotPrefix = "LOT-RECALL-CHILD-";

  // Dọn dẹp dữ liệu cũ nếu có
  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (inMemoryLots[i].id === rootLotId || inMemoryLots[i].id.startsWith(childLotPrefix)) {
      inMemoryLots.splice(i, 1);
    }
  }
  for (let i = inMemoryBatchRelations.length - 1; i >= 0; i--) {
    const p = inMemoryBatchRelations[i].parentBatchId || inMemoryBatchRelations[i].parent_batch_id;
    const c = inMemoryBatchRelations[i].childBatchId || inMemoryBatchRelations[i].child_batch_id;
    if (p === rootLotId || c === rootLotId || (c && c.startsWith(childLotPrefix))) {
      inMemoryBatchRelations.splice(i, 1);
    }
  }

  // 1. Tạo Lô gốc: Tổng lượng ban đầu 10,000 kg
  inMemoryLots.push({
    id: rootLotId,
    name: "Lô Dưa lưới Hoàng Kim (Gốc)",
    status: "Đã thu hoạch",
    organizationId: "ORG-PROD-ROOT",
    productId: "PROD-MELON-HK",
    initialQuantity: 10000,
    remainingQuantity: 0,
    productUnit: "kg",
    createdAt: "2026-10-10T08:00:00.000Z",
  });

  /**
   * Kịch bản 1: Có chính xác 20 lô hậu duệ trong lệnh thu hồi (theo đúng Scenario mô tả:
   * "Giả sử lệnh thu hồi có 20 lô, Khi xem, Thì mỗi lô kèm tổ chức, địa điểm, khối lượng còn lại và khối lượng đã tiêu thụ...").
   *
   * Tạo 20 lô phân bổ ở các nơi giữ và trạng thái:
   * - 5 lô ở Tổng kho Hà Nội (lô 1..5): mỗi lô ban đầu 500 kg, còn 400 kg, đã bán 100 kg. (Còn 2000 kg, Đã bán 500 kg)
   * - 5 lô ở Tổng kho Sài Gòn (lô 6..10): mỗi lô ban đầu 500 kg, còn 350 kg, đã bán 150 kg. (Còn 1750 kg, Đã bán 750 kg)
   * - 5 lô ở FreshMart Q1 (lô 11..15): mỗi lô ban đầu 500 kg, đã bán hết (status 'Đã bán hết', remaining 0 kg, đã bán 500 kg). (Còn 0 kg, Đã bán 2500 kg)
   * - 5 lô ở FreshMart Cầu Giấy (lô 16..20): mỗi lô ban đầu 500 kg, còn nguyên vẹn trong kho (remaining 500 kg, đã bán 0 kg). (Còn 2500 kg, Đã bán 0 kg)
   *
   * => TỔNG ĐỐI SOÁT TOÀN DIỆN:
   * - Tổng số lô thu hồi: 20 lô
   * - Tổng khối lượng ban đầu: 20 * 500 = 10,000 kg
   * - Khối lượng CÒN THU HỒI ĐƯỢC (Tại kho): 2,000 + 1,750 + 0 + 2,500 = 6,250 kg (chiếm 62.5%)
   * - Khối lượng ĐÃ RA THỊ TRƯỜNG (Tiêu thụ): 500 + 750 + 2,500 + 0 = 3,750 kg (chiếm 37.5%)
   * - Đối soát bảo toàn: 6,250 kg + 3,750 kg = 10,000 kg (Chính xác 100%, không lệch dù chỉ 0.001 kg).
   */
  const totalSubLots = 20;
  for (let i = 1; i <= totalSubLots; i++) {
    const lotNum = String(i).padStart(2, "0");
    const childId = `${childLotPrefix}${lotNum}`;
    let orgId = "ORG-DIST-NORTH";
    let locId = "LOC-WH-HN-01";
    let initQ = 500;
    let remQ = 400;
    let status = "Đã nhập kho";

    if (i >= 1 && i <= 5) {
      orgId = "ORG-DIST-NORTH";
      locId = "LOC-WH-HN-01";
      remQ = 400; // đã tiêu thụ 100 kg
    } else if (i >= 6 && i <= 10) {
      orgId = "ORG-DIST-SOUTH";
      locId = "LOC-WH-SG-01";
      remQ = 350; // đã tiêu thụ 150 kg
    } else if (i >= 11 && i <= 15) {
      orgId = "ORG-RETAIL-CHAIN";
      locId = "LOC-STORE-D1";
      remQ = 0; // đã bán hết ra thị trường
      status = "Đã bán hết";
    } else if (i >= 16 && i <= 20) {
      orgId = "ORG-RETAIL-CHAIN";
      locId = "LOC-STORE-CG";
      remQ = 500; // còn nguyên vẹn trong kho
    }

    inMemoryLots.push({
      id: childId,
      name: `Lô Dưa lưới Hoàng Kim #${lotNum}`,
      status,
      organizationId: orgId,
      locationId: locId,
      productId: "PROD-MELON-HK",
      initialQuantity: initQ,
      remainingQuantity: remQ,
      productUnit: "kg",
      createdAt: "2026-10-11T09:00:00.000Z",
    });

    inMemoryBatchRelations.push({
      parentBatchId: rootLotId,
      childBatchId: childId,
      relationType: "SPLIT",
      quantity: initQ,
      organizationId: "ORG-PROD-ROOT",
    });
  }

  const inspectorAgent = await loginAs("inspector_n2_103@gov.vn");
  const producerAgent = await loginAs("producer_n2_103@farm.vn");
  const unrelatedAgent = await loginAs("unrelated_n2_103@other.vn");
  const adminAgent = await loginAs("admin_n2_103@agri.vn");

  // =========================================================================
  // AC1: Kiểm thử Backend - Danh sách 20 lô với chi tiết từng lô
  // =========================================================================
  await t.test("AC1: Danh sách 20 lô thu hồi chi tiết từng lô kèm tổ chức, địa điểm, khối lượng còn lại và đã tiêu thụ", async () => {
    const res = await inspectorAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(res.status, 200);

    const body = res.body;
    assert.equal(body.lotId, rootLotId);
    assert.equal(body.totalDescendants, 20, "Phải có đúng 20 lô hậu duệ trong kết quả");
    assert.equal(body.descendants.length, 20);

    // Kiểm tra từng lô đều có đầy đủ thông tin: tổ chức, địa điểm, khối lượng còn lại, khối lượng đã bán
    for (const lot of body.descendants) {
      assert.ok(lot.id, "Mỗi lô phải có id");
      assert.ok(lot.organizationId, `Lô ${lot.id} phải có organizationId`);
      assert.ok(lot.organizationName, `Lô ${lot.id} phải có organizationName`);
      assert.ok(lot.locationId, `Lô ${lot.id} phải có locationId`);
      assert.ok(lot.locationName, `Lô ${lot.id} phải có locationName`);
      assert.notEqual(lot.initialQuantity, null, `Lô ${lot.id} phải có initialQuantity`);
      assert.notEqual(lot.remainingQuantity, null, `Lô ${lot.id} phải có remainingQuantity`);
      assert.notEqual(lot.consumedQuantity, null, `Lô ${lot.id} phải có consumedQuantity`);

      // Bằng chứng đối chiếu: Khối lượng ban đầu = Còn lại + Đã bán
      const sum = Number((lot.remainingQuantity + lot.consumedQuantity).toFixed(3));
      assert.equal(sum, lot.initialQuantity, `Đối chiếu lô ${lot.id}: ${lot.remainingQuantity} + ${lot.consumedQuantity} phải bằng ${lot.initialQuantity}`);
    }

    // Kiểm tra nhóm 1..5: Kho Hà Nội, còn 400 kg, đã bán 100 kg
    const lot01 = body.descendants.find((d) => d.id === `${childLotPrefix}01`);
    assert.equal(lot01.organizationId, "ORG-DIST-NORTH");
    assert.equal(lot01.organizationName, "Công ty Phân phối Miền Bắc");
    assert.equal(lot01.locationId, "LOC-WH-HN-01");
    assert.equal(lot01.locationName, "Tổng kho Lạnh Hà Nội");
    assert.equal(lot01.remainingQuantity, 400);
    assert.equal(lot01.consumedQuantity, 100);

    // Kiểm tra nhóm 11..15: FreshMart Q1, đã bán hết (remaining 0, consumed 500)
    const lot11 = body.descendants.find((d) => d.id === `${childLotPrefix}11`);
    assert.equal(lot11.organizationId, "ORG-RETAIL-CHAIN");
    assert.equal(lot11.locationId, "LOC-STORE-D1");
    assert.equal(lot11.status, "Đã bán hết");
    assert.equal(lot11.remainingQuantity, 0);
    assert.equal(lot11.consumedQuantity, 500);

    // Kiểm tra nhóm 16..20: FreshMart Cầu Giấy, còn nguyên (remaining 500, consumed 0)
    const lot16 = body.descendants.find((d) => d.id === `${childLotPrefix}16`);
    assert.equal(lot16.organizationId, "ORG-RETAIL-CHAIN");
    assert.equal(lot16.locationId, "LOC-STORE-CG");
    assert.equal(lot16.remainingQuantity, 500);
    assert.equal(lot16.consumedQuantity, 0);
  });

  // =========================================================================
  // AC2: Kiểm thử Đối soát tổng thể: Bao nhiêu còn thu hồi được, bao nhiêu đã ra thị trường
  // =========================================================================
  await t.test("AC2: Đối soát tổng thể - Thấy rõ bao nhiêu còn thu hồi được (6,250 kg) và bao nhiêu đã ra thị trường (3,750 kg)", async () => {
    const res = await inspectorAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(res.status, 200);

    const body = res.body;
    assert.ok(body.recallSummary, "Phải trả về recallSummary tổng hợp");
    assert.equal(body.recallSummary.totalLots, 20);
    assert.equal(body.recallSummary.totalRecallableQuantity, 6250, "Tổng còn thu hồi được phải là 6250 kg");
    assert.equal(body.recallSummary.totalConsumedQuantity, 3750, "Tổng đã ra thị trường phải là 3750 kg");
    assert.equal(body.recallSummary.totalInitialQuantity, 10000, "Tổng khối lượng ban đầu phải là 10000 kg");
    assert.equal(body.recallSummary.recallablePercentage, 62.5, "Tỷ lệ còn thu hồi được phải là 62.5%");
    assert.equal(body.recallSummary.consumedPercentage, 37.5, "Tỷ lệ đã ra thị trường phải là 37.5%");

    // Kiểm tra các trường alias mức top-level cho độ tương thích cao
    assert.equal(body.totalRecallableQuantity, 6250);
    assert.equal(body.totalConsumedQuantity, 3750);
    assert.equal(body.totalInitialQuantity, 10000);

    // Kiểm tra bằng chứng toán học bảo toàn khối lượng
    const balanceCheck = body.totalRecallableQuantity + body.totalConsumedQuantity;
    assert.equal(balanceCheck, body.totalInitialQuantity, "Bảo toàn khối lượng: Thu hồi được + Đã ra thị trường = Tổng ban đầu");
  });

  // =========================================================================
  // AC3: Kiểm thử Báo cáo tóm tắt theo địa điểm lưu kho (GET /api/lots/:id/descendants-summary)
  // =========================================================================
  await t.test("AC3: Báo cáo tóm tắt phân bổ theo nơi giữ (Địa điểm / Kho lưu trữ)", async () => {
    const res = await inspectorAgent.get(`/api/lots/${rootLotId}/descendants-summary`);
    assert.equal(res.status, 200);

    const body = res.body;
    assert.equal(body.descendantCount, 20);
    assert.ok(Array.isArray(body.locationSummary));
    assert.equal(body.locationSummary.length, 4, "Có 4 địa điểm kho/cửa hàng");

    // Kiểm tra vị trí Tổng kho Lạnh Hà Nội
    const locHn = body.locationSummary.find((l) => l.locationId === "LOC-WH-HN-01");
    assert.ok(locHn);
    assert.equal(locHn.totalLots, 5);
    assert.equal(locHn.totalRemainingQuantity, 2000);
    assert.equal(locHn.totalConsumedQuantity, 500);

    // Kiểm tra vị trí Tổng kho Lạnh Sài Gòn
    const locSg = body.locationSummary.find((l) => l.locationId === "LOC-WH-SG-01");
    assert.ok(locSg);
    assert.equal(locSg.totalLots, 5);
    assert.equal(locSg.totalRemainingQuantity, 1750);
    assert.equal(locSg.totalConsumedQuantity, 750);

    // Kiểm tra vị trí FreshMart Q1
    const locQ1 = body.locationSummary.find((l) => l.locationId === "LOC-STORE-D1");
    assert.ok(locQ1);
    assert.equal(locQ1.totalLots, 5);
    assert.equal(locQ1.totalRemainingQuantity, 0);
    assert.equal(locQ1.totalConsumedQuantity, 2500);

    // Kiểm tra vị trí FreshMart Cầu Giấy
    const locCg = body.locationSummary.find((l) => l.locationId === "LOC-STORE-CG");
    assert.ok(locCg);
    assert.equal(locCg.totalLots, 5);
    assert.equal(locCg.totalRemainingQuantity, 2500);
    assert.equal(locCg.totalConsumedQuantity, 0);

    // Đối soát tổng cộng các địa điểm
    const sumLocRemaining = body.locationSummary.reduce((acc, cur) => acc + cur.totalRemainingQuantity, 0);
    const sumLocConsumed = body.locationSummary.reduce((acc, cur) => acc + cur.totalConsumedQuantity, 0);
    assert.equal(Number(sumLocRemaining.toFixed(3)), 6250);
    assert.equal(Number(sumLocConsumed.toFixed(3)), 3750);
  });

  // =========================================================================
  // AC4: Trường hợp Ngoại lệ (Exceptions) & Phân quyền bảo mật (Security & NFR)
  // =========================================================================
  await t.test("AC4.1: Ngoại lệ - Trả về 404 khi truy xuất lô không tồn tại", async () => {
    const res = await inspectorAgent.get("/api/lots/LOT-NON-EXISTENT-XYZ/descendants");
    assert.equal(res.status, 404);
  });

  await t.test("AC4.2: Ngoại lệ - Trả về 403 Forbidden khi tổ chức không liên quan cố xem dữ liệu thu hồi", async () => {
    const res = await unrelatedAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(res.status, 403);
  });

  await t.test("AC4.3: Quyền hợp lệ - Producer sở hữu lô gốc được phép truy xuất danh sách thu hồi", async () => {
    const res = await producerAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(res.status, 200);
    assert.equal(res.body.totalDescendants, 20);
    assert.equal(res.body.recallSummary.totalRecallableQuantity, 6250);
  });

  await t.test("AC4.4: Ngoại lệ - Lô không có hậu duệ (Lô lá / Leaf lot) trả về thống kê 0 và isLeaf=true", async () => {
    const leafLotId = `${childLotPrefix}01`;
    const res = await inspectorAgent.get(`/api/lots/${leafLotId}/descendants`);
    assert.equal(res.status, 200);
    assert.equal(res.body.isLeaf, true);
    assert.equal(res.body.totalDescendants, 0);
    assert.equal(res.body.totalRecallableQuantity, 0);
    assert.equal(res.body.totalConsumedQuantity, 0);
  });

  await t.test("AC4.5: Quyền hợp lệ - Cả Inspector và Admin đều được phép truy xuất danh sách thu hồi (200 OK)", async () => {
    const resInspector = await inspectorAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(resInspector.status, 200, "Inspector phải nhận được 200 OK");
    assert.equal(resInspector.body.totalDescendants, 20);

    const resAdmin = await adminAgent.get(`/api/lots/${rootLotId}/descendants`);
    assert.equal(resAdmin.status, 200, "Admin phải nhận được 200 OK");
    assert.equal(resAdmin.body.totalDescendants, 20);
    assert.equal(resAdmin.body.recallSummary.totalRecallableQuantity, 6250);
  });

  // =========================================================================
  // AC5: Kiểm thử Phân tách và Gộp lô (Split/Merge) - Không bị đếm trùng lặp
  // =========================================================================
  await t.test("AC5: Phân tách và Gộp lô (Split/Merge) - Không đếm trùng lặp khối lượng của các lô trung gian đã phân tách/chuyển đổi", async () => {
    const rootTransformId = "LOT-TRANSFORM-ROOT-2026";
    const childLeafA = "LOT-TRANSFORM-LEAF-A";
    const parentInterB = "LOT-TRANSFORM-PARENT-B";
    const gcB1 = "LOT-TRANSFORM-GC-B1";
    const gcB2 = "LOT-TRANSFORM-GC-B2";

    // Dọn dẹp dữ liệu cũ nếu có
    const transformIds = [rootTransformId, childLeafA, parentInterB, gcB1, gcB2];
    for (let i = inMemoryLots.length - 1; i >= 0; i--) {
      if (transformIds.includes(inMemoryLots[i].id)) {
        inMemoryLots.splice(i, 1);
      }
    }
    for (let i = inMemoryBatchRelations.length - 1; i >= 0; i--) {
      const p = inMemoryBatchRelations[i].parentBatchId || inMemoryBatchRelations[i].parent_batch_id;
      const c = inMemoryBatchRelations[i].childBatchId || inMemoryBatchRelations[i].child_batch_id;
      if (transformIds.includes(p) || transformIds.includes(c)) {
        inMemoryBatchRelations.splice(i, 1);
      }
    }

    // Thiết lập phả hệ phân tách nhiều tầng (Multi-tier split):
    // Root: 1,000 kg ban đầu
    //  -> Tầng 1:
    //     - Lô lá A: ban đầu 400 kg, còn 300 kg, đã bán 100 kg. (Kho HN)
    //     - Lô trung gian B: ban đầu 600 kg, đã tách hết sang 2 lô cháu (remaining = 0 kg)
    //  -> Tầng 2 (tách từ Lô trung gian B):
    //     - Lô cháu B1: ban đầu 350 kg, còn nguyên 350 kg, đã bán 0 kg. (Kho SG)
    //     - Lô cháu B2: ban đầu 250 kg, còn 150 kg, đã bán 100 kg. (Store D1)
    //
    // => Kỳ vọng đối soát toàn chuỗi:
    // - Còn thu hồi được: 300 (A) + 350 (B1) + 150 (B2) = 800 kg.
    // - Đã ra thị trường: 100 (A) + 0 (B1) + 100 (B2) = 200 kg.
    // - Lô B là trung gian đã chuyển đổi sang B1 và B2: KHÔNG được coi 600 kg của B là đã bán ra thị trường,
    //   và KHÔNG được đếm trùng 600 kg của B vào tổng khối lượng ban đầu (Tổng ban đầu phải bảo toàn là 1,000 kg, không phải 1,600 kg).
    inMemoryLots.push({
      id: rootTransformId,
      name: "Lô Gốc Phân Tách Thử Nghiệm",
      status: "Đã thu hoạch",
      organizationId: "ORG-PROD-ROOT",
      productId: "PROD-MELON-HK",
      initialQuantity: 1000,
      remainingQuantity: 0,
      productUnit: "kg",
      createdAt: "2026-10-12T08:00:00.000Z",
    });

    inMemoryLots.push({
      id: childLeafA,
      name: "Lô Con Nhánh A (Lô lá)",
      status: "Đang lưu kho",
      organizationId: "ORG-DIST-NORTH",
      locationId: "LOC-WH-HN-01",
      productId: "PROD-MELON-HK",
      initialQuantity: 400,
      remainingQuantity: 300,
      productUnit: "kg",
      createdAt: "2026-10-13T08:00:00.000Z",
    });

    inMemoryLots.push({
      id: parentInterB,
      name: "Lô Con Nhánh B (Lô trung gian phân tách)",
      status: "Đã phân tách",
      organizationId: "ORG-DIST-SOUTH",
      locationId: "LOC-WH-SG-01",
      productId: "PROD-MELON-HK",
      initialQuantity: 600,
      remainingQuantity: 0,
      productUnit: "kg",
      createdAt: "2026-10-13T09:00:00.000Z",
    });

    inMemoryLots.push({
      id: gcB1,
      name: "Lô Cháu B1 (Tách từ B)",
      status: "Đang lưu kho",
      organizationId: "ORG-DIST-SOUTH",
      locationId: "LOC-WH-SG-01",
      productId: "PROD-MELON-HK",
      initialQuantity: 350,
      remainingQuantity: 350,
      productUnit: "kg",
      createdAt: "2026-10-14T08:00:00.000Z",
    });

    inMemoryLots.push({
      id: gcB2,
      name: "Lô Cháu B2 (Tách từ B)",
      status: "Đang lưu kho",
      organizationId: "ORG-RETAIL-CHAIN",
      locationId: "LOC-STORE-D1",
      productId: "PROD-MELON-HK",
      initialQuantity: 250,
      remainingQuantity: 150,
      productUnit: "kg",
      createdAt: "2026-10-14T09:00:00.000Z",
    });

    inMemoryBatchRelations.push(
      { parentBatchId: rootTransformId, childBatchId: childLeafA, relationType: "SPLIT", quantity: 400, organizationId: "ORG-PROD-ROOT" },
      { parentBatchId: rootTransformId, childBatchId: parentInterB, relationType: "SPLIT", quantity: 600, organizationId: "ORG-PROD-ROOT" },
      { parentBatchId: parentInterB, childBatchId: gcB1, relationType: "SPLIT", quantity: 350, organizationId: "ORG-DIST-SOUTH" },
      { parentBatchId: parentInterB, childBatchId: gcB2, relationType: "SPLIT", quantity: 250, organizationId: "ORG-DIST-SOUTH" }
    );

    const res = await inspectorAgent.get(`/api/lots/${rootTransformId}/descendants`);
    assert.equal(res.status, 200);

    const body = res.body;
    assert.equal(body.totalDescendants, 4, "Có 4 lô hậu duệ trong phả hệ (A, B, B1, B2)");

    // Kiểm tra lô trung gian B không bị tính là tiêu thụ ra thị trường
    const lotB = body.descendants.find((d) => d.id === parentInterB);
    assert.ok(lotB);
    assert.equal(lotB.consumedQuantity, 0, "Lô trung gian B đã chuyển đổi sang B1/B2 nên consumedQuantity phải là 0, không tính là tiêu thụ ra thị trường");

    // Kiểm tra tổng thu hồi và thị trường bảo toàn tuyệt đối, không đếm trùng
    assert.equal(body.recallSummary.totalRecallableQuantity, 800, "Tổng còn thu hồi được phải là 800 kg (300 + 350 + 150)");
    assert.equal(body.recallSummary.totalConsumedQuantity, 200, "Tổng đã ra thị trường phải là 200 kg (100 + 100)");
    assert.equal(body.recallSummary.totalInitialQuantity, 1000, "Tổng ban đầu phải bảo toàn 1,000 kg, không bị đếm trùng thành 1,600 kg");

    const sumCheck = body.recallSummary.totalRecallableQuantity + body.recallSummary.totalConsumedQuantity;
    assert.equal(sumCheck, body.recallSummary.totalInitialQuantity, "Bảo toàn khối lượng: 800 + 200 = 1000 kg");
  });
});
