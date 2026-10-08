const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { Pool } = require("pg");
const request = require("supertest");
const {
  app,
  setDatabasePool,
  users,
  hashPassword,
  inMemoryLots,
  setAppendHookForTesting,
} = require("../src/server");
const {
  isValidQuantity,
  toMilliUnits,
  fromMilliUnits,
  normalizeQuantity,
  formatQuantityString,
  validateSplitItems,
} = require("../src/quantity");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://agri_user:agri_password@localhost:5432/agri_trace";

// =========================================================================
// PHẦN 1: UNIT TEST CHO MODULE QUANTITY.JS (S-18 / T-42)
// =========================================================================
test("S-18 / T-42 Unit Tests: Chuẩn hóa và kiểm soát khối lượng chính xác đến 0,001 kg", async (t) => {
  await t.test("1.1 isValidQuantity nhận diện chính xác số dương tối đa 3 chữ số thập phân", () => {
    // Giá trị hợp lệ
    assert.equal(isValidQuantity(40), true);
    assert.equal(isValidQuantity("40"), true);
    assert.equal(isValidQuantity(40.5), true);
    assert.equal(isValidQuantity("40.125"), true);
    assert.equal(isValidQuantity(0.001), true);
    assert.equal(isValidQuantity("0.001"), true);
    assert.equal(isValidQuantity(9999.999), true);
    assert.equal(isValidQuantity(0, true), true, "Khối lượng 0 hợp lệ khi allowZero = true");

    // Giá trị không hợp lệ
    assert.equal(isValidQuantity(0), false, "Khối lượng 0 mặc định phải bị từ chối");
    assert.equal(isValidQuantity(-10), false, "Khối lượng âm phải bị từ chối");
    assert.equal(isValidQuantity("-5.5"), false, "Khối lượng âm dạng chuỗi phải bị từ chối");
    assert.equal(isValidQuantity(40.1234), false, "Quá 3 chữ số thập phân phải bị từ chối");
    assert.equal(isValidQuantity("10.0001"), false, "Chuỗi quá 3 chữ số thập phân phải bị từ chối");
    assert.equal(isValidQuantity("abc"), false, "Chuỗi ký tự chữ phải bị từ chối");
    assert.equal(isValidQuantity(null), false, "null phải bị từ chối");
    assert.equal(isValidQuantity(undefined), false, "undefined phải bị từ chối");
    assert.equal(isValidQuantity(NaN), false, "NaN phải bị từ chối");
    assert.equal(isValidQuantity(Infinity), false, "Infinity phải bị từ chối");
  });

  await t.test("1.2 toMilliUnits và fromMilliUnits bảo toàn độ chính xác không sai số IEEE 754", () => {
    assert.equal(toMilliUnits(40), 40000);
    assert.equal(toMilliUnits(40.125), 40125);
    assert.equal(toMilliUnits(0.001), 1);
    assert.equal(toMilliUnits("0.007"), 7);
    assert.equal(toMilliUnits(0, true), 0);

    assert.equal(fromMilliUnits(40000), 40);
    assert.equal(fromMilliUnits(40125), 40.125);
    assert.equal(fromMilliUnits(1), 0.001);
    assert.equal(fromMilliUnits(7), 0.007);

    assert.equal(normalizeQuantity("15.500"), 15.5);
    assert.equal(formatQuantityString(15.5), "15.500");

    assert.throws(() => toMilliUnits(-1));
    assert.throws(() => toMilliUnits(1.2345));
  });

  await t.test("1.3 validateSplitItems kiểm tra danh sách phân tách lô đầy đủ và chính xác", () => {
    // Danh sách rỗng
    const emptyCheck = validateSplitItems([]);
    assert.equal(emptyCheck.valid, false);
    assert.equal(emptyCheck.error, "INVALID_SPLITS");

    // Khối lượng không hợp lệ trong danh sách
    const invalidCheck = validateSplitItems([
      { name: "Lô A", quantity: 20 },
      { name: "Lô B", quantity: -5 },
    ]);
    assert.equal(invalidCheck.valid, false);
    assert.equal(invalidCheck.error, "INVALID_QUANTITY");
    assert.equal(invalidCheck.index, 1);

    // Hợp lệ và tính tổng chuẩn xác
    const validCheck = validateSplitItems([
      { name: "Lô 1", quantity: 12.345 },
      { name: "Lô 2", quantity: 7.655 },
    ]);
    assert.equal(validCheck.valid, true);
    assert.equal(validCheck.totalMilli, 20000);
    assert.equal(validCheck.totalQuantity, 20);
  });
});

// =========================================================================
// PHẦN 2: INTEGRATION TEST TRÊN POSTGRESQL (T-42 & T-43)
// =========================================================================
test("S-18 Concurrency & Safe Quantity Integration Tests trên PostgreSQL", async (t) => {
  let pool = null;
  let isPostgresAvailable = false;

  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
    await pool.query("SELECT 1;");
    isPostgresAvailable = true;
    setDatabasePool(pool);
  } catch (dbErr) {
    console.log("[S-18 Test] Không kết nối được PostgreSQL, bỏ qua integration DB:", dbErr.message);
  }

  const LOT_40KG_ID = "LOT-S18-40-" + crypto.randomUUID().slice(0, 8);
  const LOT_SINGLE_ID = "LOT-S18-100-" + crypto.randomUUID().slice(0, 8);

  t.after(async () => {
    if (pool) {
      try {
        await pool.query("DELETE FROM batch_relations WHERE parent_batch_id IN ($1, $2)", [LOT_40KG_ID, LOT_SINGLE_ID]);
        await pool.query("DELETE FROM lots WHERE parent_lot_id IN ($1, $2)", [LOT_40KG_ID, LOT_SINGLE_ID]);
        await pool.query("DELETE FROM lots WHERE id IN ($1, $2)", [LOT_40KG_ID, LOT_SINGLE_ID]);
      } catch (err) {
        // Bỏ qua lỗi dọn dẹp nếu bản ghi không tồn tại
        void err;
      }
      setDatabasePool(null);
      await pool.end();
    }
  });

  if (!isPostgresAvailable) {
    await t.test("PostgreSQL không khả dụng, skip DB integration tests", { skip: true }, () => {});
    return;
  }

  async function loginAs(email, password = "Password@123") {
    const agent = request.agent(app);
    const res = await agent.post("/api/login").send({ email, password });
    assert.equal(res.status, 200, `Login thất bại với email ${email}: ${res.text}`);
    return agent;
  }

  // Khởi tạo các lô kiểm thử trên PostgreSQL
  async function seedTestLots() {
    await pool.query(
      `INSERT INTO lots (
        id, name, status, organization_id, product_id,
        initial_quantity, remaining_quantity, harvested_at
      ) VALUES ($1, $2, 'Đã thu hoạch', 'org-001', 'PROD-TOMATO', 40.000, 40.000, '2026-10-08')`,
      [LOT_40KG_ID, "Lô Cà Chua Mẹ S18 (40kg)"]
    );

    await pool.query(
      `INSERT INTO lots (
        id, name, status, organization_id, product_id,
        initial_quantity, remaining_quantity, harvested_at
      ) VALUES ($1, $2, 'Đã thu hoạch', 'org-001', 'PROD-TEA', 100.000, 100.000, '2026-10-08')`,
      [LOT_SINGLE_ID, "Lô Chè Mẹ S18 (100kg)"]
    );
  }

  await seedTestLots();

  // -----------------------------------------------------------------------
  // T-42: KIỂM TỔNG KHỐI LƯỢNG TRONG GIAO DỊCH
  // -----------------------------------------------------------------------
  await t.test("2.1 T-42 AC1: Giả sử lô mẹ còn 40 kg, khi tách 50 kg thì bị chặn kèm thông báo nêu phần còn lại", async () => {
    const producerAgent = await loginAs("user@example.com");

    const res = await producerAgent
      .post(`/api/lots/${LOT_40KG_ID}/split`)
      .send({
        splits: [
          { name: "Lô con phần 1", quantity: 30 },
          { name: "Lô con phần 2", quantity: 20.001 }, // Tổng = 50.001 > 40
        ],
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "EXCEEDS_REMAINING_QUANTITY");
    assert.match(res.body.message, /vượt quá khối lượng còn lại của lô mẹ/);
    assert.match(res.body.message, /40\.000/);

    const checkRes = await pool.query("SELECT remaining_quantity FROM lots WHERE id = $1", [LOT_40KG_ID]);
    assert.equal(Number(checkRes.rows[0].remaining_quantity), 40.000);
  });

  await t.test("2.2 T-42: Chặn dữ liệu khối lượng không hợp lệ (số âm, chữ, quá 3 chữ số thập phân)", async () => {
    const producerAgent = await loginAs("user@example.com");

    // Khối lượng âm
    const resNegative = await producerAgent
      .post(`/api/lots/${LOT_SINGLE_ID}/split`)
      .send({ splits: [{ name: "Lô con", quantity: -10 }] });
    assert.equal(resNegative.status, 400);
    assert.equal(resNegative.body.error, "INVALID_QUANTITY");

    // Quá 3 chữ số thập phân
    const resOverPrecision = await producerAgent
      .post(`/api/lots/${LOT_SINGLE_ID}/split`)
      .send({ splits: [{ name: "Lô con", quantity: 10.1234 }] });
    assert.equal(resOverPrecision.status, 400);
    assert.equal(resOverPrecision.body.error, "INVALID_QUANTITY");

    // Khối lượng = 0
    const resZero = await producerAgent
      .post(`/api/lots/${LOT_SINGLE_ID}/split`)
      .send({ splits: [{ name: "Lô con", quantity: 0 }] });
    assert.equal(resZero.status, 400);
    assert.equal(resZero.body.error, "INVALID_QUANTITY");
  });

  // -----------------------------------------------------------------------
  // T-43: KIỂM THỬ HAI GIAO DỊCH TÁCH ĐỒNG THỜI TRÊN POSTGRESQL
  // -----------------------------------------------------------------------
  await t.test("2.3 T-43: Hai giao dịch cùng tách một lô mẹ 40 kg, mỗi bên 30 kg song song -> Chỉ đúng 1 thành công, bên kia nhận lỗi không đủ khối lượng", async () => {
    // Hai người dùng cùng thuộc org-001 (user và orgadmin)
    const agentA = await loginAs("user@example.com");
    const agentB = await loginAs("orgadmin@example.com");

    // Gửi 2 request tách 30 kg đồng thời
    const [resA, resB] = await Promise.all([
      agentA.post(`/api/lots/${LOT_40KG_ID}/split`).send({
        splits: [{ name: "Lô con yêu cầu bởi User A (30kg)", quantity: 30.000 }],
      }),
      agentB.post(`/api/lots/${LOT_40KG_ID}/split`).send({
        splits: [{ name: "Lô con yêu cầu bởi User B (30kg)", quantity: 30.000 }],
      }),
    ]);

    const results = [resA, resB];
    const successRes = results.find((r) => r.status === 201);
    const failRes = results.find((r) => r.status === 400);

    // Xác nhận một request thành công và một request thất bại
    assert.ok(successRes, "Phải có đúng một giao dịch tách thành công (201)");
    assert.ok(failRes, "Phải có đúng một giao dịch tách thất bại (400)");

    // Giao dịch thành công phải trừ đúng 30 kg, còn lại 10 kg
    assert.equal(successRes.body.parentLot.remainingQuantity, 10.000);
    assert.equal(successRes.body.childLots.length, 1);
    assert.equal(successRes.body.childLots[0].initialQuantity, 30.000);

    // Giao dịch thất bại phải nhận lỗi EXCEEDS_REMAINING_QUANTITY
    assert.equal(failRes.body.error, "EXCEEDS_REMAINING_QUANTITY");
    assert.match(failRes.body.message, /vượt quá khối lượng còn lại/);

    // Kiểm tra trực tiếp trong PostgreSQL: khối lượng còn lại đúng 10.000 kg
    const parentDb = await pool.query("SELECT remaining_quantity FROM lots WHERE id = $1", [LOT_40KG_ID]);
    assert.equal(Number(parentDb.rows[0].remaining_quantity), 10.000, "Khối lượng còn lại trong DB phải là 10.000 kg");

    // Chỉ có 1 lô con được tạo
    const childrenDb = await pool.query("SELECT * FROM lots WHERE parent_lot_id = $1", [LOT_40KG_ID]);
    assert.equal(childrenDb.rows.length, 1, "Chỉ được tạo duy nhất 1 lô con trong DB");
    assert.equal(Number(childrenDb.rows[0].initial_quantity), 30.000);

    // Chỉ có 1 quan hệ batch_relations được ghi nhận
    const relsDb = await pool.query("SELECT * FROM batch_relations WHERE parent_batch_id = $1", [LOT_40KG_ID]);
    assert.equal(relsDb.rows.length, 1, "Chỉ có đúng 1 quan hệ phả hệ phân tách được lưu");
  });

  // -----------------------------------------------------------------------
  // T-42 / AC3: TÁCH NHIỀU LẦN LIÊN TIẾP CHUẨN XÁC ĐẾN TỪNG GRAM (0,001 kg)
  // -----------------------------------------------------------------------
  await t.test("2.4 T-42 AC3: Tách nhiều lần liên tiếp, tổng khối lượng mọi lô con bằng đúng khối lượng đã trừ từ lô mẹ, không lệch một gram", async () => {
    const producerAgent = await loginAs("user@example.com");

    // Hiện tại lô LOT_40KG_ID đang còn 10.000 kg (sau lần tách 30 kg ở trên)
    // Lần 1: Tách 3.250 kg -> còn lại 6.750 kg
    const split1 = await producerAgent
      .post(`/api/lots/${LOT_40KG_ID}/split`)
      .send({
        splits: [{ name: "Lô con 3.250 kg", quantity: 3.25 }],
      });
    assert.equal(split1.status, 201);
    assert.equal(split1.body.parentLot.remainingQuantity, 6.75);

    // Lần 2: Tách hết 6.750 kg còn lại -> còn lại đúng 0.000 kg
    const split2 = await producerAgent
      .post(`/api/lots/${LOT_40KG_ID}/split`)
      .send({
        splits: [
          { name: "Lô con phần A", quantity: 2.75 },
          { name: "Lô con phần B", quantity: 4.0 },
        ],
      });
    assert.equal(split2.status, 201);
    assert.equal(split2.body.parentLot.remainingQuantity, 0.000);

    // Lần 3: Thử tách tiếp khi đã còn 0 kg -> bị chặn lập tức
    const split3 = await producerAgent
      .post(`/api/lots/${LOT_40KG_ID}/split`)
      .send({
        splits: [{ name: "Lô con vét kho", quantity: 0.001 }],
      });
    assert.equal(split3.status, 400);
    assert.equal(split3.body.error, "EXCEEDS_REMAINING_QUANTITY");

    // Kiểm tra tổng khối lượng tất cả các lô con trong PostgreSQL:
    const allChildren = await pool.query(
      "SELECT SUM(initial_quantity) as total_children FROM lots WHERE parent_lot_id = $1",
      [LOT_40KG_ID]
    );
    const totalChildQty = Number(allChildren.rows[0].total_children);

    // Ban đầu 40.000 kg, đã tách hết 40.000 kg (30 + 3.25 + 2.75 + 4.0 = 40.0)
    assert.equal(totalChildQty, 40.000, "Tổng khối lượng các lô con phải bằng đúng 40.000 kg, không lệch 1 gram");

    // Lô mẹ còn lại đúng 0.000 kg
    const parentCheck = await pool.query("SELECT remaining_quantity FROM lots WHERE id = $1", [LOT_40KG_ID]);
    assert.equal(Number(parentCheck.rows[0].remaining_quantity), 0.000);
  });

  // -----------------------------------------------------------------------
  // ROLLBACK TOÀN DIỆN KHI XẢY RA LỖI (T-42)
  // -----------------------------------------------------------------------
  await t.test("2.5 T-42 Rollback: Nếu lỗi trong quá trình xử lý, toàn bộ thay đổi (lô mẹ, lô con, phả hệ, sự kiện) được rollback", async () => {
    const producerAgent = await loginAs("user@example.com");

    const beforeLotsCountRes = await pool.query("SELECT count(*)::int as c FROM lots");
    const beforeLotsCount = beforeLotsCountRes.rows[0].c;

    const beforeRelationsCountRes = await pool.query("SELECT count(*)::int as c FROM batch_relations");
    const beforeRelationsCount = beforeRelationsCountRes.rows[0].c;

    // Giả lập lỗi ở hook appendBatchEvent trong transaction
    let eventCount = 0;
    setAppendHookForTesting((eventData) => {
      if (eventData.eventType === "CREATED_FROM_SPLIT") {
        eventCount++;
        if (eventCount === 1) {
          throw new Error("Lỗi mô phỏng ghi sự kiện ledger T-42");
        }
      }
    });

    try {
      const res = await producerAgent
        .post(`/api/lots/${LOT_SINGLE_ID}/split`)
        .send({
          splits: [{ name: "Lô con gây rollback", quantity: 25.0 }],
        });

      assert.equal(res.status, 500);
      assert.match(res.body.message, /Lỗi mô phỏng ghi sự kiện ledger/);

      // Kiểm tra lô mẹ không bị trừ khối lượng (vẫn nguyên 100.000 kg)
      const parentRes = await pool.query("SELECT remaining_quantity FROM lots WHERE id = $1", [LOT_SINGLE_ID]);
      assert.equal(Number(parentRes.rows[0].remaining_quantity), 100.000);

      // Không có lô con nào bị lưu vào bảng lots
      const afterLotsCountRes = await pool.query("SELECT count(*)::int as c FROM lots");
      assert.equal(afterLotsCountRes.rows[0].c, beforeLotsCount);

      // Không có bản ghi phả hệ rác
      const afterRelationsCountRes = await pool.query("SELECT count(*)::int as c FROM batch_relations");
      assert.equal(afterRelationsCountRes.rows[0].c, beforeRelationsCount);
    } finally {
      setAppendHookForTesting(null);
    }
  });
});

// =========================================================================
// PHẦN 3: IN-MEMORY FALLBACK TEST (T-42 AN TOÀN TRÊN CẢ IN-MEMORY)
// =========================================================================
test("S-18 / T-42 In-Memory Fallback: Kiểm soát khối lượng chính xác tuyệt đối", async (t) => {
  // Đảm bảo ở chế độ in-memory
  setDatabasePool(null);

  const passwordHash = await hashPassword("Password@123");
  users.set("mem_user_s18@org1.vn", {
    id: "usr-mem-s18",
    email: "mem_user_s18@org1.vn",
    passwordHash,
    failedCount: 0,
    lockedUntil: null,
    organizationId: "org-001",
    roleId: "producer",
  });

  const agent = request.agent(app);
  const loginRes = await agent.post("/api/login").send({ email: "mem_user_s18@org1.vn", password: "Password@123" });
  assert.equal(loginRes.status, 200);

  const MEM_LOT_ID = "LOT-MEM-S18-40KG";

  // Thêm lô test vào inMemoryLots
  inMemoryLots.push({
    id: MEM_LOT_ID,
    name: "Lô In-Memory 40kg",
    status: "Đã thu hoạch",
    organizationId: "org-001",
    productId: "PROD-TOMATO",
    initialQuantity: 40.0,
    remainingQuantity: 40.0,
    harvestedAt: "2026-10-08",
  });

  t.after(() => {
    const idx = inMemoryLots.findIndex((l) => l.id === MEM_LOT_ID);
    if (idx !== -1) inMemoryLots.splice(idx, 1);
  });

  await t.test("3.1 In-memory: Chặn tách 50kg trên lô 40kg", async () => {
    const res = await agent.post(`/api/lots/${MEM_LOT_ID}/split`).send({
      splits: [{ name: "Lô vượt", quantity: 50.0 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "EXCEEDS_REMAINING_QUANTITY");
  });

  await t.test("3.2 In-memory: Tách chuẩn xác từng gram không sai số dấu phẩy động", async () => {
    const res1 = await agent.post(`/api/lots/${MEM_LOT_ID}/split`).send({
      splits: [{ name: "Lô 1", quantity: 15.125 }, { name: "Lô 2", quantity: 24.875 }],
    });
    assert.equal(res1.status, 201);
    assert.equal(res1.body.parentLot.remainingQuantity, 0.0);

    // Thử tách tiếp khi còn 0kg
    const res2 = await agent.post(`/api/lots/${MEM_LOT_ID}/split`).send({
      splits: [{ name: "Lô dư", quantity: 0.001 }],
    });
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, "EXCEEDS_REMAINING_QUANTITY");
  });
});
