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

const isCI = process.env.CI === "true" || process.env.CI === "1";
const isDbRequired =
  isCI ||
  process.env.REQUIRE_DB === "true" ||
  process.env.REQUIRE_POSTGRES === "true" ||
  process.env.STRICT_POSTGRES === "true";

// Chỉ cho phép chạy trên CSDL test cô lập (disposable test database)
// Ngăn chặn tuyệt đối việc migrate, seed, truncate hoặc ghi vào CSDL dùng chung/live
const isDisposableDbConfirmed =
  isCI ||
  Boolean(process.env.TEST_DATABASE_URL) ||
  process.env.CONFIRMED_DISPOSABLE_DB === "true";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://agri_app:app_password@localhost:5432/agri_trace";
const MIGRATION_DATABASE_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ||
  process.env.MIGRATION_DATABASE_URL ||
  "postgresql://agri_migration:migration_password@localhost:5432/agri_trace";

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
  if (!isDisposableDbConfirmed) {
    const guardMsg =
      "[S-40 PG Test Guard] Không phát hiện CSDL test cô lập (disposable test database). " +
      "Để bảo vệ CSDL dùng chung/live không bị ghi, migrate, seed hoặc truncate, " +
      "bài test yêu cầu cấu hình TEST_DATABASE_URL hoặc CONFIRMED_DISPOSABLE_DB=true.";
    if (isDbRequired) {
      assert.fail(`[REQUIRED-DB/CI FAILURE] ${guardMsg}`);
    }
    console.log(`[SKIP] ${guardMsg}`);
    t.skip("Bỏ qua do chưa cấu hình CSDL PostgreSQL test cô lập (chế độ an toàn local)");
    return;
  }

  let dbConnectionError = null;
  try {
    migrationPool = new Pool({ connectionString: MIGRATION_DATABASE_URL, connectionTimeoutMillis: 3000 });
    pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
    await pool.query("SELECT 1;");
    isPostgresAvailable = true;
    setDatabasePool(pool);
  } catch (err) {
    dbConnectionError = err.message || err.code || String(err);
    console.warn("[S-40 PG Test] Không kết nối được PostgreSQL:", dbConnectionError);
    isPostgresAvailable = false;
  }

  if (!isPostgresAvailable) {
    if (isDbRequired) {
      assert.fail(`[REQUIRED-DB/CI FAILURE] PostgreSQL is required but could not connect: ${dbConnectionError}`);
    }
    console.log(`[SKIP] PostgreSQL không kết nối được (${dbConnectionError}), bỏ qua integration test trên PostgreSQL.`);
    t.skip("Bỏ qua do PostgreSQL không khả dụng trên môi trường test cục bộ (optional local mode)");
    return;
  }

  // Chuẩn bị schema bảng shipments, shipment_lots và lot_transfers theo docs/S40_API_CONTRACT.md & S-16
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_cold_box
    ON shipments (cold_box_id)
    WHERE status = 'IN_TRANSIT';

    CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
    CREATE INDEX IF NOT EXISTS idx_shipment_lots_shipment ON shipment_lots(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_shipment_lots_lot ON shipment_lots(lot_id);

    CREATE TABLE IF NOT EXISTS lot_transfers (
      id VARCHAR(50) PRIMARY KEY DEFAULT ('trf-' || substr(md5(random()::text), 1, 8)),
      lot_id VARCHAR(50) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      from_organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
      to_organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
      notes TEXT,
      created_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      resolved_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      rejection_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_different_orgs CHECK (from_organization_id <> to_organization_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_transfer_per_lot 
    ON lot_transfers (lot_id) 
    WHERE status = 'PENDING';

    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipments TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_lots TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON lot_transfers TO agri_app;
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
  const LOT_DISJOINT_1 = "LOT-S40-DISJ-1";
  const LOT_DISJOINT_2 = "LOT-S40-DISJ-2";

  // Dọn dẹp dữ liệu cũ nếu còn sót lại từ lần chạy trước
  await pool.query("DELETE FROM lot_transfers WHERE lot_id LIKE 'LOT-S40-%';");
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
    { id: LOT_DISJOINT_1, name: "Lô Tách Biệt 1", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
    { id: LOT_DISJOINT_2, name: "Lô Tách Biệt 2", org: ORG_TRANS, status: "Đang giữ", remaining: 100 },
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
      if (pool) {
        await pool.query("DELETE FROM lot_transfers WHERE lot_id LIKE 'LOT-S40-%';");
        await pool.query("DELETE FROM shipment_lots WHERE lot_id LIKE 'LOT-S40-%';");
        await pool.query("DELETE FROM shipments WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
        await pool.query("DELETE FROM audit_logs WHERE organization_id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
        await pool.query("DELETE FROM lots WHERE id LIKE 'LOT-S40-%';");
        await pool.query("DELETE FROM users WHERE email IN ($1, $2, $3, $4);", [
          USER_TRANS_EMAIL,
          USER_FARM_EMAIL,
          USER_OTHER_EMAIL,
          USER_INSP_EMAIL,
        ]);
        await pool.query("DELETE FROM organizations WHERE id IN ($1, $2, $3);", [ORG_TRANS, ORG_FARM, ORG_OTHER]);
      }
      if (migrationPool) {
        await migrationPool.query("DELETE FROM batch_events WHERE batch_id LIKE 'LOT-S40-%';");
      }
      setDatabasePool(null);
      if (pool) await pool.end();
      if (migrationPool) await migrationPool.end();
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

    await s4.test("4.3 Xác nhận cả hai partial unique index tồn tại trên PostgreSQL vật lý", async () => {
      const idxLotsRes = await pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'shipment_lots' AND indexname = 'idx_unique_active_shipment_per_lot';"
      );
      assert.equal(idxLotsRes.rows.length, 1, "Partial unique index idx_unique_active_shipment_per_lot phải tồn tại");

      const idxColdBoxRes = await pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'shipments' AND indexname = 'idx_unique_active_shipment_per_cold_box';"
      );
      assert.equal(idxColdBoxRes.rows.length, 1, "Partial unique index idx_unique_active_shipment_per_cold_box phải tồn tại");
    });

    await s4.test("4.4 Tranh chấp đồng thời - Hai chuyến cùng gán 1 thùng lạnh với các lô tách biệt (Disjoint lots: 1x 201, 1x 409 COLD_BOX_ALREADY_IN_USE)", async () => {
      const raceColdBox = "CBX-RACE-BOX-DISJ";
      const req1Promise = transAgent.post("/api/shipments").send({
        coldBoxId: raceColdBox,
        lotIds: [LOT_DISJOINT_1],
        notes: "Request Chuyến Thùng Lạnh A gửi đồng thời",
      });

      const req2Promise = transAgent.post("/api/shipments").send({
        coldBoxId: raceColdBox,
        lotIds: [LOT_DISJOINT_2],
        notes: "Request Chuyến Thùng Lạnh B gửi đồng thời",
      });

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

      const statuses = [res1.status, res2.status];
      const has201 = statuses.includes(201);
      const has409 = statuses.includes(409);

      assert.ok(has201, `Phải có đúng 1 request thành công (201). Nhận được: ${statuses.join(", ")}`);
      assert.ok(has409, `Phải có đúng 1 request bị chặn do trùng thùng lạnh (409). Nhận được: ${statuses.join(", ")}`);

      const conflictRes = res1.status === 409 ? res1 : res2;
      assert.equal(conflictRes.body.error, "COLD_BOX_ALREADY_IN_USE");

      // Kiểm tra DB: raceColdBox chỉ được gắn vào duy nhất 1 chuyến đang hoạt động
      const dbCheck = await pool.query(
        "SELECT COUNT(*) AS active_count FROM shipments WHERE cold_box_id = $1 AND status = 'IN_TRANSIT';",
        [raceColdBox]
      );
      assert.equal(parseInt(dbCheck.rows[0].active_count, 10), 1, "Chỉ duy nhất 1 chuyến active cho thùng lạnh này");
    });

    await s4.test("4.5 Chặn gán thùng lạnh đã nằm trong chuyến active khi gọi tuần tự (409 COLD_BOX_ALREADY_IN_USE)", async () => {
      const res = await transAgent.post("/api/shipments").send({
        coldBoxId: "CBX-RACE-BOX-DISJ",
        lotIds: [LOT_3],
        notes: "Cố gán thùng lạnh đang trong chuyến hoạt động",
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "COLD_BOX_ALREADY_IN_USE");
      assert.match(res.body.message, /đang tham gia một chuyến vận chuyển khác/);
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

    await s6.test("6.4 Hoàn thành chuyến vận chuyển: Ghi nhận sự kiện xuống xe (SHIPMENT_UNLOADED) và kiểm tra tính toàn vẹn K-01", async () => {
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

  // =========================================================================
  // SUITE 7: Nghiệp vụ bàn giao liên tổ chức sau khi dỡ hàng (S-16 Handover & Ownership)
  // =========================================================================
  let transferLot1Id = null;
  let transferLot2Id = null;

  await t.test("SUITE 7: Nghiệp vụ bàn giao liên tổ chức sau khi dỡ hàng (S-16 Handover & Ownership)", async (s7) => {
    await s7.test("7.1 Khởi tạo yêu cầu bàn giao S-15/S-16 cho các lô sau khi hoàn tất chuyến vận chuyển (PENDING)", async () => {
      // transAgent (ORG_TRANS) gửi yêu cầu bàn giao LOT_1 và LOT_2 sang ORG_OTHER sau khi dỡ hàng
      const tr1Res = await transAgent
        .post(`/api/lots/${LOT_1}/transfers`)
        .send({
          toOrganizationId: ORG_OTHER,
          notes: "Bàn giao lô dâu tây 1 sau khi hoàn thành chuyến shp và dỡ hàng thành công",
        });
      assert.equal(tr1Res.status, 201, `Tạo transfer LOT_1 thất bại: ${JSON.stringify(tr1Res.body)}`);
      assert.ok(tr1Res.body.transfer);
      transferLot1Id = tr1Res.body.transfer.id;
      assert.equal(tr1Res.body.transfer.lotId, LOT_1);
      assert.equal(tr1Res.body.transfer.fromOrganizationId, ORG_TRANS);
      assert.equal(tr1Res.body.transfer.toOrganizationId, ORG_OTHER);
      assert.equal(tr1Res.body.transfer.status, "PENDING");

      const tr2Res = await transAgent
        .post(`/api/lots/${LOT_2}/transfers`)
        .send({
          toOrganizationId: ORG_OTHER,
          notes: "Bàn giao lô dâu tây 2 sau khi hoàn thành chuyến shp và dỡ hàng thành công",
        });
      assert.equal(tr2Res.status, 201, `Tạo transfer LOT_2 thất bại: ${JSON.stringify(tr2Res.body)}`);
      assert.ok(tr2Res.body.transfer);
      transferLot2Id = tr2Res.body.transfer.id;
      assert.equal(tr2Res.body.transfer.lotId, LOT_2);
      assert.equal(tr2Res.body.transfer.fromOrganizationId, ORG_TRANS);
      assert.equal(tr2Res.body.transfer.toOrganizationId, ORG_OTHER);
      assert.equal(tr2Res.body.transfer.status, "PENDING");

      // Khẳng định trên CSDL PostgreSQL: 2 bản ghi lot_transfers ở trạng thái PENDING
      const dbTransfers = await pool.query(
        "SELECT id, lot_id, from_organization_id, to_organization_id, status FROM lot_transfers WHERE id IN ($1, $2);",
        [transferLot1Id, transferLot2Id]
      );
      assert.equal(dbTransfers.rows.length, 2);
      for (const row of dbTransfers.rows) {
        assert.equal(row.status, "PENDING");
        assert.equal(row.from_organization_id, ORG_TRANS);
        assert.equal(row.to_organization_id, ORG_OTHER);
      }

      // Khẳng định quyền sở hữu trong thời gian chờ (PENDING): vẫn thuộc ORG_TRANS
      const dbLotsCheck = await pool.query(
        "SELECT id, organization_id FROM lots WHERE id IN ($1, $2);",
        [LOT_1, LOT_2]
      );
      for (const row of dbLotsCheck.rows) {
        assert.equal(row.organization_id, ORG_TRANS, "Trong trạng thái PENDING, quyền sở hữu chưa được đổi");
      }
    });

    await s7.test("7.2 Phân quyền và ràng buộc lý do từ chối (S-16 RBAC & Reason Validation)", async () => {
      // 1. Bên gửi (transAgent) cố tự confirm yêu cầu bàn giao của chính mình -> 403 Forbidden
      const selfConfirmRes = await transAgent.post(`/api/transfers/${transferLot1Id}/confirm`).send({});
      assert.equal(selfConfirmRes.status, 403);
      assert.equal(selfConfirmRes.body.error, "FORBIDDEN");

      // 2. Cán bộ kiểm tra (inspAgent) cố confirm -> 403 Forbidden
      const inspConfirmRes = await inspAgent.post(`/api/transfers/${transferLot1Id}/confirm`).send({});
      assert.equal(inspConfirmRes.status, 403);

      // 3. Cán bộ kiểm tra cố reject -> 403 Forbidden
      const inspRejectRes = await inspAgent
        .post(`/api/transfers/${transferLot2Id}/reject`)
        .send({ reason: "Lý do từ chối kiểm tra dài hơn mười ký tự" });
      assert.equal(inspRejectRes.status, 403);

      // 4. Bên nhận (otherAgent) từ chối nhưng để trống lý do -> 400 Bad Request
      const emptyRejectRes = await otherAgent.post(`/api/transfers/${transferLot2Id}/reject`).send({});
      assert.equal(emptyRejectRes.status, 400);
      assert.equal(emptyRejectRes.body.error, "INVALID_REASON");

      // 5. Bên nhận từ chối với lý do < 10 ký tự -> 400 Bad Request
      const shortRejectRes = await otherAgent
        .post(`/api/transfers/${transferLot2Id}/reject`)
        .send({ reason: "Hỏng hàng" });
      assert.equal(shortRejectRes.status, 400);
      assert.equal(shortRejectRes.body.error, "INVALID_REASON");
    });

    await s7.test("7.3 S-16 AC1 Confirm: Bên nhận xác nhận bàn giao LOT-S40-001 -> Đổi chủ sở hữu sang ORG_OTHER và toàn vẹn K-01", async () => {
      // otherAgent thuộc ORG_OTHER xác nhận tiếp nhận bàn giao LOT_1
      const confirmRes = await otherAgent.post(`/api/transfers/${transferLot1Id}/confirm`).send({});
      assert.equal(confirmRes.status, 200, `Confirm thất bại: ${JSON.stringify(confirmRes.body)}`);
      assert.equal(confirmRes.body.transfer.status, "CONFIRMED");
      assert.ok(confirmRes.body.event.eventHash);

      // 1. Khẳng định quyền sở hữu trên CSDL PostgreSQL: lots.organization_id ĐÃ ĐỔI SANG ORG_OTHER
      const dbLot1 = await pool.query("SELECT organization_id FROM lots WHERE id = $1;", [LOT_1]);
      assert.equal(dbLot1.rows[0].organization_id, ORG_OTHER, "Quyền sở hữu trong CSDL phải chuyển sang ORG_OTHER");

      // 2. Khẳng định qua API chi tiết lô: GET /api/lots/:id bằng otherAgent trả về organizationId = ORG_OTHER
      const lot1ApiRes = await otherAgent.get(`/api/lots/${LOT_1}`);
      assert.equal(lot1ApiRes.status, 200);
      assert.equal(lot1ApiRes.body.lot.organizationId, ORG_OTHER);

      // 3. Khẳng định lô xuất hiện trong danh mục lô đang quản lý của ORG_OTHER
      const orgLotsRes = await otherAgent.get("/api/organization/lots");
      assert.equal(orgLotsRes.status, 200);
      assert.ok(orgLotsRes.body.lots.some((l) => l.id === LOT_1), "LOT_1 phải nằm trong danh mục lô của ORG_OTHER");

      // 4. Khẳng định chuỗi băm sự kiện SHA-256 (K-01) liên tục qua 5 mắt xích:
      // HARVEST_RECORDED (1) -> SHIPMENT_LOADED (2) -> SHIPMENT_UNLOADED (3) -> TRANSFER_INITIATED (4) -> TRANSFER_CONFIRMED (5)
      const eventsRes = await pool.query(
        "SELECT event_type, sequence_no, previous_hash, event_hash FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC;",
        [LOT_1]
      );
      assert.equal(eventsRes.rows.length, 5, "LOT_1 phải có đủ 5 sự kiện sau khi confirm");
      assert.equal(eventsRes.rows[0].event_type, "HARVEST_RECORDED");
      assert.equal(eventsRes.rows[1].event_type, "SHIPMENT_LOADED");
      assert.equal(eventsRes.rows[2].event_type, "SHIPMENT_UNLOADED");
      assert.equal(eventsRes.rows[3].event_type, "TRANSFER_INITIATED");
      assert.equal(eventsRes.rows[4].event_type, "TRANSFER_CONFIRMED");
      assert.equal(eventsRes.rows[4].sequence_no, 5);
      assert.equal(eventsRes.rows[4].previous_hash, eventsRes.rows[3].event_hash, "previous_hash phải khớp event_hash của TRANSFER_INITIATED");

      // 5. Kiểm tra toàn vẹn K-01 qua API
      const integrityRes = await inspAgent.get(`/api/lots/${LOT_1}/integrity`);
      assert.equal(integrityRes.status, 200);
      assert.equal(integrityRes.body.integrity.valid, true, "Chuỗi băm K-01 sau confirm phải hợp lệ");

      // 6. Chặn confirm lần 2 -> 409 Conflict
      const reConfirmRes = await otherAgent.post(`/api/transfers/${transferLot1Id}/confirm`).send({});
      assert.equal(reConfirmRes.status, 409);
      assert.equal(reConfirmRes.body.error, "TRANSFER_ALREADY_RESOLVED");
    });

    await s7.test("7.4 S-16 AC2 Reject: Bên nhận từ chối bàn giao LOT-S40-002 -> Giữ nguyên chủ cũ ORG_TRANS và ghi event", async () => {
      const rejectionReason = "Nhiệt độ thùng lạnh ghi nhận 14 độ C trong suốt chuyến, vi phạm dải bảo quản 2-4 độ C";
      const rejectRes = await otherAgent
        .post(`/api/transfers/${transferLot2Id}/reject`)
        .send({ reason: rejectionReason });

      assert.equal(rejectRes.status, 200, `Reject thất bại: ${JSON.stringify(rejectRes.body)}`);
      assert.equal(rejectRes.body.transfer.status, "REJECTED");
      assert.equal(rejectRes.body.transfer.rejectionReason, rejectionReason);
      assert.ok(rejectRes.body.event.eventHash);

      // 1. Khẳng định quyền sở hữu trên CSDL PostgreSQL: lots.organization_id VẪN LÀ ORG_TRANS (KHÔNG ĐỔI CHỦ)
      const dbLot2 = await pool.query("SELECT organization_id FROM lots WHERE id = $1;", [LOT_2]);
      assert.equal(dbLot2.rows[0].organization_id, ORG_TRANS, "Khi bị từ chối, quyền sở hữu trong CSDL giữ nguyên ORG_TRANS");

      // 2. Khẳng định qua API: transAgent (ORG_TRANS) vẫn có quyền quản lý LOT_2
      const lot2ApiRes = await transAgent.get(`/api/lots/${LOT_2}`);
      assert.equal(lot2ApiRes.status, 200);
      assert.equal(lot2ApiRes.body.lot.organizationId, ORG_TRANS);

      // 3. Khẳng định chuỗi băm sự kiện SHA-256 (K-01) liên tục qua 5 mắt xích:
      // HARVEST_RECORDED (1) -> SHIPMENT_LOADED (2) -> SHIPMENT_UNLOADED (3) -> TRANSFER_INITIATED (4) -> TRANSFER_REJECTED (5)
      const eventsRes = await pool.query(
        "SELECT event_type, sequence_no, previous_hash, event_hash, payload FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC;",
        [LOT_2]
      );
      assert.equal(eventsRes.rows.length, 5, "LOT_2 phải có đủ 5 sự kiện sau khi reject");
      assert.equal(eventsRes.rows[0].event_type, "HARVEST_RECORDED");
      assert.equal(eventsRes.rows[1].event_type, "SHIPMENT_LOADED");
      assert.equal(eventsRes.rows[2].event_type, "SHIPMENT_UNLOADED");
      assert.equal(eventsRes.rows[3].event_type, "TRANSFER_INITIATED");
      assert.equal(eventsRes.rows[4].event_type, "TRANSFER_REJECTED");
      assert.equal(eventsRes.rows[4].sequence_no, 5);
      assert.equal(eventsRes.rows[4].previous_hash, eventsRes.rows[3].event_hash, "previous_hash phải khớp event_hash của TRANSFER_INITIATED");
      assert.equal(eventsRes.rows[4].payload.reason, rejectionReason);

      // 4. Kiểm tra toàn vẹn K-01 qua API
      const integrityRes = await inspAgent.get(`/api/lots/${LOT_2}/integrity`);
      assert.equal(integrityRes.status, 200);
      assert.equal(integrityRes.body.integrity.valid, true, "Chuỗi băm K-01 sau reject phải hợp lệ");

      // 5. Chặn reject hoặc confirm lần 2 -> 409 Conflict
      const reRejectRes = await otherAgent
        .post(`/api/transfers/${transferLot2Id}/reject`)
        .send({ reason: "Cố từ chối lần 2 trên cùng transfer" });
      assert.equal(reRejectRes.status, 409);
      assert.equal(reRejectRes.body.error, "TRANSFER_ALREADY_RESOLVED");
    });
  });
});
