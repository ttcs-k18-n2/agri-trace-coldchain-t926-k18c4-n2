const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  inMemoryLots,
  inMemoryProducts,
} = require("../src/server");
const {
  validateMergeItems,
} = require("../src/quantity");

async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return agent;
}

test("S-19 & S-18 Integration: Chuẩn hóa khối lượng gộp lô đến 0,001 kg và phả hệ đa nguồn", async (t) => {
  const passwordHash = await hashPassword("Password123!");

  users.set("dist_merge_precision@org3.vn", {
    id: "usr-dist-precision",
    email: "dist_merge_precision@org3.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-precision-01",
    roleId: "distributor",
  });

  users.set("admin_precision@org.vn", {
    id: "usr-admin-precision",
    email: "admin_precision@org.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-precision-01",
    roleId: "admin",
  });

  const testProduct = { id: "PROD-PRECISION-TOMATO", name: "Cà chua bi thử nghiệm", unit: "kg" };
  if (!inMemoryProducts.some((p) => p.id === testProduct.id)) {
    inMemoryProducts.push(testProduct);
  }

  // 1. UNIT TESTS: validateMergeItems
  await t.test("1. validateMergeItems: Kiểm tra chặt chẽ số chữ số thập phân và chống sai số dấu phẩy động", () => {
    // Hợp lệ: 2 lô với 3 chữ số thập phân
    const validRes = validateMergeItems([
      { parent_batch_id: "LOT-01", take_quantity: "10.125" },
      { parent_batch_id: "LOT-02", take_quantity: 20.375 },
    ]);
    assert.equal(validRes.valid, true);
    assert.equal(validRes.totalMilli, 30500);
    assert.equal(validRes.totalQuantity, 30.5);
    assert.equal(validRes.normalizedItems.length, 2);

    // Bị từ chối: Quá 3 chữ số thập phân
    const overPrecision = validateMergeItems([
      { parent_batch_id: "LOT-01", take_quantity: "10.1234" },
      { parent_batch_id: "LOT-02", take_quantity: 20 },
    ]);
    assert.equal(overPrecision.valid, false);
    assert.equal(overPrecision.error, "INVALID_QUANTITY");
    assert.match(overPrecision.message, /tối đa 3 chữ số thập phân/);

    // Bị từ chối: Số âm, 0, NaN, Infinity
    assert.equal(
      validateMergeItems([
        { parent_batch_id: "LOT-01", take_quantity: -5 },
        { parent_batch_id: "LOT-02", take_quantity: 10 },
      ]).valid,
      false
    );
    assert.equal(
      validateMergeItems([
        { parent_batch_id: "LOT-01", take_quantity: 0 },
        { parent_batch_id: "LOT-02", take_quantity: 10 },
      ]).valid,
      false
    );
    assert.equal(
      validateMergeItems([
        { parent_batch_id: "LOT-01", take_quantity: Infinity },
        { parent_batch_id: "LOT-02", take_quantity: 10 },
      ]).valid,
      false
    );

    // Bị từ chối: Trùng lặp mã lô mẹ
    const duplicate = validateMergeItems([
      { parent_batch_id: "LOT-01", take_quantity: 10 },
      { parent_batch_id: "LOT-01", take_quantity: 10 },
    ]);
    assert.equal(duplicate.valid, false);
    assert.equal(duplicate.error, "DUPLICATE_PARENT_LOT");

    // Bị từ chối: Ít hơn 2 lô mẹ
    assert.equal(
      validateMergeItems([{ parent_batch_id: "LOT-01", take_quantity: 10 }]).valid,
      false
    );
  });

  // 2. INTEGRATION TESTS: POST /api/lots/merge với độ chính xác milli-units
  const lotP1 = "LOT-PREC-01";
  const lotP2 = "LOT-PREC-02";

  // Dọn dẹp lô thử nghiệm cũ
  for (let i = inMemoryLots.length - 1; i >= 0; i--) {
    if (inMemoryLots[i].id.startsWith("LOT-PREC-")) {
      inMemoryLots.splice(i, 1);
    }
  }

  inMemoryLots.push(
    {
      id: lotP1,
      name: "Lô Nguồn 1",
      status: "Đã thu hoạch",
      organizationId: "org-precision-01",
      productId: testProduct.id,
      initialQuantity: 100.555,
      remainingQuantity: 100.555,
      harvestedAt: "2026-10-01T08:00:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
      parentLotId: null,
    },
    {
      id: lotP2,
      name: "Lô Nguồn 2",
      status: "Đã thu hoạch",
      organizationId: "org-precision-01",
      productId: testProduct.id,
      initialQuantity: 200.445,
      remainingQuantity: 200.445,
      harvestedAt: "2026-10-01T08:00:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
      parentLotId: null,
    }
  );

  await t.test("2. POST /api/lots/merge: Chặn giá trị vượt quá 3 chữ số thập phân", async () => {
    const agent = await loginAs("dist_merge_precision@org3.vn");
    const res = await agent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotP1, take_quantity: "50.1234" },
        { parent_batch_id: lotP2, take_quantity: 50 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "INVALID_QUANTITY");
    assert.match(res.body.message, /tối đa 3 chữ số thập phân/);
  });

  await t.test("3. POST /api/lots/merge: Gộp chính xác 3 chữ số thập phân không bị lỗi số thực IEEE 754", async () => {
    const agent = await loginAs("dist_merge_precision@org3.vn");
    const res = await agent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotP1, take_quantity: 0.1 },
        { parent_batch_id: lotP2, take_quantity: 0.2 },
      ],
      name: "Lô Gộp Thập Phân Chuẩn",
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.lot);
    // 0.1 + 0.2 trong IEEE 754 là 0.30000000000000004 nhưng với milli-units phải là đúng 0.3
    assert.equal(res.body.lot.initialQuantity, 0.3);
    assert.equal(res.body.lot.remainingQuantity, 0.3);

    // Kiểm tra lô mẹ còn lại chuẩn xác
    const p1 = inMemoryLots.find((l) => l.id === lotP1);
    const p2 = inMemoryLots.find((l) => l.id === lotP2);
    assert.equal(p1.remainingQuantity, 100.455);
    assert.equal(p2.remainingQuantity, 200.245);
  });

  await t.test("4. POST /api/lots/merge: Chặn khi khối lượng lấy vượt quá remaining_quantity dù chỉ 0.001 kg", async () => {
    const agent = await loginAs("dist_merge_precision@org3.vn");

    // Lô p1 hiện còn 100.455 kg, yêu cầu lấy 100.456 kg (vượt đúng 0.001 kg)
    const res = await agent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotP1, take_quantity: 100.456 },
        { parent_batch_id: lotP2, take_quantity: 50 },
      ],
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "EXCEEDS_REMAINING_QUANTITY");
  });

  // 3. MULTI-PARENT LINEAGE TEST: Lô có 2 mẹ phải trả về đủ cả 2 trong parentLots
  await t.test("5. GET /api/lots/:id: Trả về đầy đủ tất cả các lô mẹ (parentLots) cho lô gộp", async () => {
    const agent = await loginAs("dist_merge_precision@org3.vn");

    // Gộp lô mới từ lotP1 và lotP2
    const mergeRes = await agent.post("/api/lots/merge").send({
      items: [
        { parent_batch_id: lotP1, take_quantity: 10 },
        { parent_batch_id: lotP2, take_quantity: 20 },
      ],
      name: "Lô Gộp 2 Mẹ",
    });

    assert.equal(mergeRes.status, 201);
    const newLotId = mergeRes.body.lot.id;

    // Xem chi tiết lô gộp mới tạo
    const detailRes = await agent.get(`/api/lots/${newLotId}`);
    assert.equal(detailRes.status, 200);
    assert.ok(detailRes.body.lot);

    const lot = detailRes.body.lot;
    assert.ok(Array.isArray(lot.parentLots), "parentLots phải là mảng");
    assert.equal(lot.parentLots.length, 2, "Phải chứa cả 2 lô mẹ");

    const parentIds = lot.parentLots.map((p) => p.id);
    assert.ok(parentIds.includes(lotP1), "Phải có lô mẹ 1");
    assert.ok(parentIds.includes(lotP2), "Phải có lô mẹ 2");
  });

  // 4. MIGRATION 018 VERIFICATION
  await t.test("6. Migration 018: Tồn tại và chứa đầy đủ các quyền DML cho agri_app", () => {
    const fs = require("fs");
    const path = require("path");
    const migPath = path.resolve(__dirname, "../../db/migrations/018_grant_agri_app_permissions.sql");
    assert.ok(fs.existsSync(migPath), "File migration 018 phải tồn tại");

    const sqlContent = fs.readFileSync(migPath, "utf-8");
    assert.match(sqlContent, /lot_transfers/, "Migration 018 phải cấp quyền lot_transfers");
    assert.match(sqlContent, /batch_relations/, "Migration 018 phải cấp quyền batch_relations");
    assert.match(sqlContent, /REVOKE UPDATE, DELETE, TRUNCATE ON batch_events FROM agri_app/, "Phải bảo toàn append-only");
    assert.match(sqlContent, /ALTER DEFAULT PRIVILEGES/, "Phải thiết lập default privileges");
  });
});
