const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const request = require("supertest");
const {
  app,
  users,
  hashPassword,
  setDatabasePool,
} = require("../src/server");
const { GENESIS_HASH, calculateEventHash } = require("../src/integrity");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://agri_app:app_password@localhost:5432/agri_trace";
const MIGRATION_DATABASE_URL =
  process.env.MIGRATION_DATABASE_URL || "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";

let pool;
let migrationPool;
let isPostgresAvailable = false;

// Helpers
async function loginAs(email, password = "Password123!") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ email, password });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return agent;
}

test("S-40 (Jira N2-211/N2-212): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh trên PostgreSQL thực tế", async (t) => {
  try {
    migrationPool = new Pool({ connectionString: MIGRATION_DATABASE_URL, connectionTimeoutMillis: 3000 });
    pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
    await pool.query("SELECT 1;");
    isPostgresAvailable = true;
    setDatabasePool(pool);
  } catch (err) {
    console.warn("[S-40 PG Test] Không kết nối được PostgreSQL:", err.message);
    isPostgresAvailable = false;
  }

  if (!isPostgresAvailable) {
    t.skip("Bỏ qua do PostgreSQL không khả dụng trên môi trường test cục bộ");
    return;
  }

  // Chuẩn bị schema bảng shipments và shipment_lots theo docs/S40_API_CONTRACT.md (mục 3)
  await migrationPool.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id VARCHAR(50) PRIMARY KEY DEFAULT ('shp-' || substr(md5(random()::text), 1, 8)),
      cold_box_id VARCHAR(50) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
      organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
      created_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      completed_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      vehicle_plate VARCHAR(50),
      driver_name VARCHAR(100),
      driver_phone VARCHAR(20),
      origin_location_id VARCHAR(50),
      destination_location_id VARCHAR(50),
      notes TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shipment_lots (
      id VARCHAR(50) PRIMARY KEY DEFAULT ('shplot-' || substr(md5(random()::text), 1, 8)),
      shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      lot_id VARCHAR(50) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      status VARCHAR(30) NOT NULL DEFAULT 'LOADED' CHECK (status IN ('LOADED', 'DELIVERED', 'REMOVED')),
      loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unloaded_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_shipment_lot_pair UNIQUE (shipment_id, lot_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_lot 
    ON shipment_lots (lot_id) 
    WHERE is_active = TRUE;

    CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
    CREATE INDEX IF NOT EXISTS idx_shipment_lots_shipment ON shipment_lots(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_shipment_lots_lot ON shipment_lots(lot_id);

    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipments TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_lots TO agri_app;
      END IF;
    END $$;
  `);

  // Dữ liệu thử nghiệm cố định
  const ORG_TRANS = "org-s40-trans";
  const ORG_FARM = "org-s40-farm";
  const ORG_OTHER = "org-s40-other";

  const USER_TRANS_EMAIL = "transporter_s40@agri.vn";
  const USER_FARM_EMAIL = "farmer_s40@agri.vn";
  const USER_OTHER_EMAIL = "other_s40@agri.vn";
  const USER_INSP_EMAIL = "inspector_s40@agri.vn";

  const LOT_1 = "LOT-S40-001";
  const LOT_2 = "LOT-S40-002";
  const LOT_3 = "LOT-S40-003";
  const LOT_CONSUMED = "LOT-S40-CONS";
  const LOT_CONCURRENT = "LOT-S40-CONCUR";
  const LOT_OTHER_ORG = "LOT-S40-OTHER";

  // Dọn dẹp dữ liệu cũ nếu còn sót lại từ lần chạy trước
  await pool.query("DELETE FROM shipment_lots WHERE lot_id LIKE 'LOT-S40-%';");
  await pool.query("DELETE FROM shipments WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
  await migrationPool.query("DELETE FROM batch_events WHERE batch_id LIKE 'LOT-S40-%';");
  await pool.query("DELETE FROM audit_logs WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
  await pool.query("DELETE FROM lots WHERE id LIKE 'LOT-S40-%';");
  await pool.query("DELETE FROM users WHERE email IN ($1, $2, $3, $4);", [
    USER_TRANS_EMAIL,
    USER_FARM_EMAIL,
    USER_OTHER_EMAIL,
    USER_INSP_EMAIL,
  ]);
  await pool.query("DELETE FROM organizations WHERE id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);

  // Tạo tổ chức
  await pool.query(`
    INSERT INTO organizations (id, name, type) VALUES
      ($1, 'Công ty Vận chuyển Chuỗi Lạnh S40', 'transporter'),
      ($2, 'Hợp tác xã Nông trại S40', 'producer'),
      ($3, 'Công ty Bán lẻ Đối thủ S40', 'distributor')
    ON CONFLICT (id) DO NOTHING;
  `, [ORG_TRANS, ORG_FARM, ORG_OTHER]);

  // Tạo người dùng
  const passHash = await hashPassword("Password123!");
  const userDefs = [
    { id: "usr-s40-trans", email: USER_TRANS_EMAIL, role: "transporter", org: ORG_TRANS },
    { id: "usr-s40-farm", email: USER_FARM_EMAIL, role: "producer", org: ORG_FARM },
    { id: "usr-s40-other", email: USER_OTHER_EMAIL, role: "distributor", org: ORG_OTHER },
    { id: "usr-s40-insp", email: USER_INSP_EMAIL, role: "inspector", org: ORG_OTHER },
  ];

  for (const u of userDefs) {
    await pool.query(`
      INSERT INTO users (id, email, password_hash, organization_id, role_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO NOTHING;
    `, [u.id, u.email, passHash, u.org, u.role]);

    users.set(u.email, {
      id: u.id,
      email: u.email,
      passwordHash: passHash,
      organizationId: u.org,
      roleId: u.role,
      failedCount: 0,
      lockedUntil: null,
    });
  }

  // Tạo các lô thử nghiệm
  const lotsToInsert = [
    { id: LOT_1, name: "Lô Dâu tây A1", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
    { id: LOT_2, name: "Lô Dâu tây A2", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
    { id: LOT_3, name: "Lô Dâu tây A3", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
    { id: LOT_CONSUMED, name: "Lô Đã Tiêu Thụ", org: ORG_TRANS, status: "Đã tiêu thụ", remaining: 0 },
    { id: LOT_CONCURRENT, name: "Lô Tranh Chấp Đồng Thời", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
    { id: LOT_OTHER_ORG, name: "Lô Của Tổ Chức Khác", org: ORG_OTHER, status: "Đang giữ", remaining: 100 },
  ];

  for (const l of lotsToInsert) {
    await pool.query(`
      INSERT INTO lots (id, name, organization_id, status, remaining_quantity, initial_quantity)
      VALUES ($1, $2, $3, $4, $5, 100)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, remaining_quantity = EXCLUDED.remaining_quantity;
    `, [l.id, l.name, l.org, l.status, l.remaining]);

    // Tạo sự kiện ban đầu (HARVEST_RECORDED) có chuỗi hash SHA-256 hợp lệ K-01
    const initPayload = { lotId: l.id, name: l.name, action: "INITIAL_SEED" };
    const eventDate = new Date();
    const eventObj = {
      batchId: l.id,
      sequenceNo: 1,
      eventType: "HARVEST_RECORDED",
      payload: initPayload,
      organizationId: l.org,
      actorUserId: "usr-s40-trans",
      occurredAt: eventDate.toISOString(),
    };
    const genesisHash = calculateEventHash(GENESIS_HASH, eventObj);

    await pool.query(`
      INSERT INTO batch_events (id, batch_id, sequence_no, event_type, payload, organization_id, actor_user_id, occurred_at, previous_hash, event_hash)
      VALUES ($1, $2, 1, 'HARVEST_RECORDED', $3::jsonb, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING;
    `, [`evt-s40-init-${l.id}`, l.id, JSON.stringify(initPayload), l.org, "usr-s40-trans", eventDate.toISOString(), GENESIS_HASH, genesisHash]);
  }

  // Khởi tạo các session agents
  let transAgent;
  let otherAgent;
  let inspAgent;

  transAgent = await loginAs(USER_TRANS_EMAIL);
  otherAgent = await loginAs(USER_OTHER_EMAIL);
  inspAgent = await loginAs(USER_INSP_EMAIL);

  t.after(async () => {
    try {
      await pool.query("DELETE FROM shipment_lots WHERE lot_id LIKE 'LOT-S40-%';");
      await pool.query("DELETE FROM shipments WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
      await migrationPool.query("DELETE FROM batch_events WHERE batch_id LIKE 'LOT-S40-%';");
      await pool.query("DELETE FROM audit_logs WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
      await pool.query("DELETE FROM lots WHERE id LIKE 'LOT-S40-%';");
      await pool.query("DELETE FROM users WHERE email IN ($1, $2, $3, $4);", [
        USER_TRANS_EMAIL,
        USER_FARM_EMAIL,
        USER_OTHER_EMAIL,
        USER_INSP_EMAIL,
      ]);
      await pool.query("DELETE FROM organizations WHERE id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
      await pool.end();
      await migrationPool.end();
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // SUITE 1: Phân quyền & Cô lập tổ chức (RBAC & Multi-tenant Authorization)
  // =========================================================================
  await t.test("SUITE 1: Phân quyền tổ chức và vai trò (Security & RBAC)", async (s1) => {
    await s1.test("1.1 Unauthenticated: Chặn request khi chưa đăng nhập (401 Unauthorized)", async () => {
      const res = await request(app)
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_1],
        });
      assert.equal(res.status, 401, "Phải trả về 401 khi chưa đăng nhập");
      assert.ok(res.body.message || res.body.error, "Phải có thông báo lỗi");
    });

    await s1.test("1.2 Inspector: Cán bộ kiểm tra bị cấm mở chuyến vận chuyển (403 Forbidden)", async () => {
      const res = await inspAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_OTHER_ORG],
        });
      assert.equal(res.status, 403, "Inspector không có quyền tạo chuyến vận chuyển");
      assert.ok(res.body.message || res.body.error, "Phải có thông báo lỗi 403");
    });

    await s1.test("1.3 Multi-tenant: Chặn người dùng đưa lô của tổ chức khác vào chuyến (403 FORBIDDEN_LOT_ACCESS)", async () => {
      // transAgent thuộc ORG_TRANS cố tình gắn LOT_OTHER_ORG thuộc ORG_OTHER
      const res = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_1, LOT_OTHER_ORG],
        });
      assert.equal(res.status, 403, "Chặn truy cập chéo tổ chức khi lô thuộc tổ chức khác");
      assert.equal(res.body.error, "FORBIDDEN_LOT_ACCESS");
    });

    await s1.test("1.4 Inspector: Cán bộ kiểm tra bị cấm kết thúc chuyến vận chuyển (403 Forbidden)", async () => {
      const res = await inspAgent
        .post("/api/shipments/shp-dummy/complete")
        .send({ notes: "Cố kết thúc trái phép" });
      assert.equal(res.status, 403, "Inspector không có quyền hoàn thành chuyến");
    });
  });

  // =========================================================================
  // SUITE 2: Kiểm tra dữ liệu đầu vào & Ngoại lệ (Payload Validation)
  // =========================================================================
  await t.test("SUITE 2: Kiểm tra tính hợp lệ của dữ liệu đầu vào (Validation & Edge Cases)", async (s2) => {
    await s2.test("2.1 Chặn khi thiếu coldBoxId (400 MISSING_COLD_BOX_ID)", async () => {
      const res = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "",
          lotIds: [LOT_1],
        });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "MISSING_COLD_BOX_ID");
    });

    await s2.test("2.2 Chặn khi thiếu hoặc mảng lotIds rỗng (400 MISSING_LOT_IDS)", async () => {
      const res1 = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [],
        });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.error, "MISSING_LOT_IDS");

      const res2 = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
        });
      assert.equal(res2.status, 400);
      assert.equal(res2.body.error, "MISSING_LOT_IDS");
    });

    await s2.test("2.3 Chặn khi mảng lotIds chứa mã lô trùng lặp trong request (400 DUPLICATE_LOT_IN_REQUEST)", async () => {
      const res = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_1, LOT_2, LOT_1], // Trùng LOT_1
        });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "DUPLICATE_LOT_IN_REQUEST");
    });

    await s2.test("2.4 Chặn khi chứa mã lô không tồn tại trong hệ thống (404 LOT_NOT_FOUND)", async () => {
      const res = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_1, "LOT-S40-NON-EXISTENT"],
        });
      assert.equal(res.status, 404);
      assert.equal(res.body.error, "LOT_NOT_FOUND");
    });

    await s2.test("2.5 Chặn khi chứa lô đã tiêu thụ / đóng gói (400 LOT_ALREADY_CONSUMED)", async () => {
      const res = await transAgent
        .post("/api/shipments")
        .send({
          coldBoxId: "CBX-S40-001",
          lotIds: [LOT_1, LOT_CONSUMED],
        });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "LOT_ALREADY_CONSUMED");
    });

    await s2.test("2.6 Chặn kết thúc chuyến khi shipmentId không tồn tại (404 SHIPMENT_NOT_FOUND)", async () => {
      const res = await transAgent
        .post("/api/shipments/shp-not-found-999/complete")
        .send({});
      assert.equal(res.status, 404);
      assert.equal(res.body.error, "SHIPMENT_NOT_FOUND");
    });
  });

  // =========================================================================
  // SUITE 3: Luồng chính - Mở chuyến 1 thùng lạnh, nhiều lô & Truy vấn
  // =========================================================================
  let createdShipmentId = null;

  await t.test("SUITE 3: Luồng chính - Mở chuyến 1 thùng lạnh, nhiều lô (Happy Path)", async (s3) => {
    await s3.test("3.1 Tạo chuyến vận chuyển gắn 1 thùng lạnh và 2 lô thành công (201 Created)", async () => {
      const payload = {
        coldBoxId: "CBX-S40-001",
        lotIds: [LOT_1, LOT_2],
        vehiclePlate: "29C-999.99",
        driverName: "Trần Văn Vận Chuyển",
        driverPhone: "0987654321",
        originLocationId: "LOC-WH-TN-01",
        destinationLocationId: "LOC-HUB-HN-01",
        notes: "Chuyến dâu tây bảo quản nhiệt độ chuẩn 2-4 độ C",
      };

      const res = await transAgent.post("/api/shipments").send(payload);
      assert.equal(res.status, 201, `Tạo chuyến thất bại: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);
      assert.ok(res.body.shipment, "Response phải có object shipment");

      createdShipmentId = res.body.shipment.id;
      assert.ok(createdShipmentId.startsWith("shp-"), `Mã chuyến phải có tiền tố shp-: ${createdShipmentId}`);
      assert.equal(res.body.shipment.coldBoxId, "CBX-S40-001");
      assert.equal(res.body.shipment.status, "IN_TRANSIT");
      assert.equal(res.body.shipment.organizationId, ORG_TRANS);
      assert.equal(res.body.shipment.vehiclePlate, "29C-999.99");
      assert.equal(res.body.shipment.driverName, "Trần Văn Vận Chuyển");

      // Kiểm tra danh sách lô được gắn
      assert.ok(Array.isArray(res.body.shipment.lots));
      assert.equal(res.body.shipment.lots.length, 2);

      const lotIdsInResponse = res.body.shipment.lots.map((l) => l.lotId);
      assert.ok(lotIdsInResponse.includes(LOT_1));
      assert.ok(lotIdsInResponse.includes(LOT_2));

      for (const l of res.body.shipment.lots) {
        assert.equal(l.status, "LOADED");
        assert.ok(l.event, "Mỗi lô phải có sự kiện băm đi kèm");
        assert.equal(l.event.eventType, "SHIPMENT_LOADED");
        assert.ok(l.event.eventHash);
      }
    });

    await s3.test("3.2 Xem chi tiết chuyến vận chuyển (GET /api/shipments/:id)", async () => {
      assert.ok(createdShipmentId, "Phải có mã chuyến từ test 3.1");
      const res = await transAgent.get(`/api/shipments/${createdShipmentId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.shipment.id, createdShipmentId);
      assert.equal(res.body.shipment.status, "IN_TRANSIT");
      assert.equal(res.body.shipment.lots.length, 2);
    });

    await s3.test("3.3 Tra cứu danh sách chuyến (GET /api/shipments) hỗ trợ lọc và phân trang", async () => {
      const res = await transAgent.get("/api/shipments?status=IN_TRANSIT&coldBoxId=CBX-S40-001&limit=10&offset=0");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.some((s) => s.id === createdShipmentId));
      assert.ok(res.body.pagination);
      assert.ok(res.body.pagination.total >= 1);
    });

    await s3.test("3.4 Tra cứu chuyến đang hoạt động của lô (GET /api/lots/:id/active-shipment)", async () => {
      const res = await transAgent.get(`/api/lots/${LOT_1}/active-shipment`);
      assert.equal(res.status, 200);
      assert.equal(res.body.hasActiveShipment, true);
      assert.ok(res.body.shipment);
      assert.equal(res.body.shipment.id, createdShipmentId);
      assert.equal(res.body.shipment.coldBoxId, "CBX-S40-001");
      assert.equal(res.body.shipment.status, "IN_TRANSIT");
    });
  });

  // =========================================================================
  // SUITE 4: Kiểm thử tranh chấp đồng thời (Concurrency Control)
  // =========================================================================
  await t.test("SUITE 4: Tranh chấp đồng thời - Hai chuyến cùng gắn 1 lô (Concurrency Race)", async (s4) => {
    await s4.test("4.1 Race condition: 2 request đồng thời cùng đưa LOT-S40-CONCUR vào 2 chuyến khác nhau", async () => {
      // Chuẩn bị 2 request đồng thời cùng gán LOT_CONCURRENT
      const req1Promise = transAgent.post("/api/shipments").send({
        coldBoxId: "CBX-RACE-01",
        lotIds: [LOT_CONCURRENT],
        notes: "Request Chuyến A gửi đồng thời",
      });

      const req2Promise = transAgent.post("/api/shipments").send({
        coldBoxId: "CBX-RACE-02",
        lotIds: [LOT_CONCURRENT],
        notes: "Request Chuyến B gửi đồng thời",
      });

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

      const statuses = [res1.status, res2.status];
      const has201 = statuses.includes(201);
      const has409 = statuses.includes(409);

      assert.ok(has201, `Phải có đúng 1 request thành công (201). Nhận được: ${statuses.join(", ")}`);
      assert.ok(has409, `Phải có đúng 1 request bị chặn do xung đột (409). Nhận được: ${statuses.join(", ")}`);

      // Kiểm tra request 409 trả về đúng mã lỗi LOT_ALREADY_IN_ACTIVE_SHIPMENT
      const conflictRes = res1.status === 409 ? res1 : res2;
      assert.equal(conflictRes.body.error, "LOT_ALREADY_IN_ACTIVE_SHIPMENT");

      // Kiểm tra DB: LOT_CONCURRENT chỉ được gắn vào duy nhất 1 chuyến đang hoạt động
      const dbCheck = await pool.query(
        "SELECT COUNT(*) AS active_count FROM shipment_lots WHERE lot_id = $1 AND is_active = TRUE;",
        [LOT_CONCURRENT]
      );
      assert.equal(parseInt(dbCheck.rows[0].active_count, 10), 1, "Chỉ duy nhất 1 chuyến active cho lô này");
    });

    await s4.test("4.2 Chặn gán lô đã nằm trong chuyến active khi gọi tuần tự (409 Conflict)", async () => {
      // LOT_1 đang nằm trong createdShipmentId (chưa complete)
      const res = await transAgent.post("/api/shipments").send({
        coldBoxId: "CBX-S40-NEW",
        lotIds: [LOT_1],
        notes: "Cố gán LOT_1 đang trong chuyến",
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "LOT_ALREADY_IN_ACTIVE_SHIPMENT");
      assert.ok(Array.isArray(res.body.conflictingLots));
      assert.ok(res.body.conflictingLots.some((c) => c.lotId === LOT_1));
    });
  });

  // =========================================================================
  // SUITE 5: Tính nguyên tử & Rollback giao dịch trên PostgreSQL
  // =========================================================================
  await t.test("SUITE 5: Tính nguyên tử & Rollback giao dịch PostgreSQL (ACID Rollback)", async (s5) => {
    await s5.test("5.1 Rollback toàn phần khi 1 trong số các lô vi phạm điều kiện (Atomic Batch)", async () => {
      // Đếm số lượng shipments và shipment_lots hiện tại
      const countShipmentsBefore = parseInt(
        (await pool.query("SELECT COUNT(*) FROM shipments;")).rows[0].count,
        10
      );
      const countShipmentLotsBefore = parseInt(
        (await pool.query("SELECT COUNT(*) FROM shipment_lots;")).rows[0].count,
        10
      );
      const countEventsBefore = parseInt(
        (await pool.query("SELECT COUNT(*) FROM batch_events WHERE batch_id = $1;", [LOT_3])).rows[0].count,
        10
      );

      // Gửi request gồm LOT_3 (hợp lệ) và LOT_OTHER_ORG (vi phạm tổ chức)
      const res = await transAgent.post("/api/shipments").send({
        coldBoxId: "CBX-FAIL-ROLLBACK",
        lotIds: [LOT_3, LOT_OTHER_ORG],
        notes: "Request cố tình lỗi để kiểm tra rollback",
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.error, "FORBIDDEN_LOT_ACCESS");

      // Kiểm tra DB sau khi rollback: Số lượng bản ghi KHÔNG ĐỔI
      const countShipmentsAfter = parseInt(
        (await pool.query("SELECT COUNT(*) FROM shipments;")).rows[0].count,
        10
      );
      const countShipmentLotsAfter = parseInt(
        (await pool.query("SELECT COUNT(*) FROM shipment_lots;")).rows[0].count,
        10
      );
      const countEventsAfter = parseInt(
        (await pool.query("SELECT COUNT(*) FROM batch_events WHERE batch_id = $1;", [LOT_3])).rows[0].count,
        10
      );

      assert.equal(countShipmentsAfter, countShipmentsBefore, "Không được tạo bản ghi rác trong shipments");
      assert.equal(countShipmentLotsAfter, countShipmentLotsBefore, "Không được tạo bản ghi rác trong shipment_lots");
      assert.equal(countEventsAfter, countEventsBefore, "Không được tạo sự kiện mồ côi cho LOT_3 trong batch_events");
    });
  });

  // =========================================================================
  // SUITE 6: Sự kiện lên xe/xuống xe, Chuỗi hash SHA-256 (K-01) & Audit Log (S-31)
  // =========================================================================
  await t.test("SUITE 6: Chuỗi băm SHA-256 (K-01), Audit Log (S-31) và Xuống xe S-16", async (s6) => {
    await s6.test("6.1 Kiểm tra sự kiện lên xe (SHIPMENT_LOADED) và tính toàn vẹn K-01", async () => {
      // Kiểm tra sự kiện của LOT_1 trong batch_events
      const evtRes = await pool.query(
        "SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC;",
        [LOT_1]
      );
      assert.equal(evtRes.rows.length, 2, "LOT_1 phải có 2 sự kiện (HARVEST_RECORDED và SHIPMENT_LOADED)");

      const loadEvt = evtRes.rows[1];
      assert.equal(loadEvt.event_type, "SHIPMENT_LOADED");
      assert.equal(loadEvt.sequence_no, 2);
      assert.equal(loadEvt.previous_hash, evtRes.rows[0].event_hash);
      assert.ok(loadEvt.event_hash);

      // Kiểm tra API tính toàn vẹn của lô LOT_1 (cần quyền inspector/admin)
      const integrityRes = await inspAgent.get(`/api/lots/${LOT_1}/integrity`);
      assert.equal(integrityRes.status, 200);
      assert.equal(integrityRes.body.integrity.valid, true, "Chuỗi băm K-01 của lô phải hoàn toàn hợp lệ");
    });

    await s6.test("6.2 Kiểm tra Audit Log SHIPMENT_CREATED được ghi nhận vào PostgreSQL", async () => {
      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE resource_type = 'shipment' AND resource_id = $1 AND action = 'SHIPMENT_CREATED';",
        [createdShipmentId]
      );
      assert.equal(auditRes.rows.length, 1, "Phải có 1 bản ghi audit log SHIPMENT_CREATED");
      assert.equal(auditRes.rows[0].organization_id, ORG_TRANS);
      assert.equal(auditRes.rows[0].actor_email, USER_TRANS_EMAIL);
    });

    await s6.test("6.3 Chặn tổ chức khác hoàn thành chuyến (403 FORBIDDEN_SHIPMENT_ACCESS)", async () => {
      // otherAgent thuộc ORG_OTHER cố hoàn thành chuyến của ORG_TRANS
      const res = await otherAgent.post(`/api/shipments/${createdShipmentId}/complete`).send({
        notes: "Trộm hàng",
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "FORBIDDEN_SHIPMENT_ACCESS");
    });

    await s6.test("6.4 Hoàn thành chuyến vận chuyển: Ghi nhận sự kiện xuống xe (SHIPMENT_UNLOADED) và S-16", async () => {
      const completeRes = await transAgent
        .post(`/api/shipments/${createdShipmentId}/complete`)
        .send({
          notes: "Đã giao đến kho Long Biên, dỡ hàng thành công",
          destinationLocationId: "LOC-HUB-HN-01",
        });

      assert.equal(completeRes.status, 200, `Hoàn thành chuyến thất bại: ${JSON.stringify(completeRes.body)}`);
      assert.equal(completeRes.body.success, true);
      assert.equal(completeRes.body.shipment.status, "COMPLETED");

      // Kiểm tra DB: shipment_lots chuyển sang is_active = FALSE, status = 'DELIVERED'
      const checkLots = await pool.query(
        "SELECT * FROM shipment_lots WHERE shipment_id = $1;",
        [createdShipmentId]
      );
      assert.equal(checkLots.rows.length, 2);
      for (const row of checkLots.rows) {
        assert.equal(row.is_active, false, "Lô trong chuyến completed phải có is_active = FALSE");
        assert.equal(row.status, "DELIVERED");
        assert.ok(row.unloaded_at);
      }

      // Kiểm tra sự kiện SHIPMENT_UNLOADED trong batch_events
      const evtRes = await pool.query(
        "SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC;",
        [LOT_1]
      );
      assert.equal(evtRes.rows.length, 3, "LOT_1 phải có 3 sự kiện (HARVEST, LOADED, UNLOADED)");
      const unloadEvt = evtRes.rows[2];
      assert.equal(unloadEvt.event_type, "SHIPMENT_UNLOADED");
      assert.equal(unloadEvt.sequence_no, 3);
      assert.equal(unloadEvt.previous_hash, evtRes.rows[1].event_hash);

      // Kiểm tra toàn vẹn K-01 sau khi dỡ hàng
      const integrityRes = await inspAgent.get(`/api/lots/${LOT_1}/integrity`);
      assert.equal(integrityRes.status, 200);
      assert.equal(integrityRes.body.integrity.valid, true, "Chuỗi băm K-01 sau khi dỡ hàng phải hợp lệ");

      // Kiểm tra active shipment của LOT_1 đã trở về false
      const activeRes = await transAgent.get(`/api/lots/${LOT_1}/active-shipment`);
      assert.equal(activeRes.status, 200);
      assert.equal(activeRes.body.hasActiveShipment, false);

      // Kiểm tra Audit Log SHIPMENT_COMPLETED
      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE resource_type = 'shipment' AND resource_id = $1 AND action = 'SHIPMENT_COMPLETED';",
        [createdShipmentId]
      );
      assert.equal(auditRes.rows.length, 1, "Phải có 1 bản ghi audit log SHIPMENT_COMPLETED");
    });

    await s6.test("6.5 Chặn gọi complete lần 2 khi chuyến đã hoàn thành (400 SHIPMENT_ALREADY_COMPLETED)", async () => {
      const res = await transAgent.post(`/api/shipments/${createdShipmentId}/complete`).send({});
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "SHIPMENT_ALREADY_COMPLETED");
    });
  });
});
