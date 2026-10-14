const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { calculateEventHash, GENESIS_HASH } = require("../src/integrity");

const SEED_FILE = path.resolve(__dirname, "../../db/seed_s39.sql");

function getPool() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || "postgres"}:${process.env.POSTGRES_PASSWORD || "postgres"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "agri_trace"}`;
  return new Pool({ connectionString });
}

/**
 * Danh sách định nghĩa 15 lô hàng cho Story S-39
 */
const S39_LOTS = [
  // Tầng 1: Lô thu hoạch nguồn gốc (F0)
  {
    id: "R01",
    name: "Lô Cà chua Nguồn R01",
    status: "Đã thu hoạch",
    organizationId: "ORG-A",
    farmId: "FARM-ORG-A",
    productId: "PROD-TOMATO",
    initialQuantity: 1000.0,
    remainingQuantity: 200.0,
    harvestedAt: "2026-10-01",
    parentLotId: null,
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  {
    id: "R02",
    name: "Lô Cà chua Nguồn R02",
    status: "Đã thu hoạch",
    organizationId: "ORG-A",
    farmId: "FARM-ORG-A",
    productId: "PROD-TOMATO",
    initialQuantity: 800.0,
    remainingQuantity: 300.0,
    harvestedAt: "2026-10-01",
    parentLotId: null,
    createdAt: "2026-10-01T08:30:00.000Z",
  },
  {
    id: "R03",
    name: "Lô Cà chua Nguồn R03",
    status: "Đã thu hoạch",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 500.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-01",
    parentLotId: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  },

  // Tầng 2: Sơ chế & Phân loại
  {
    id: "R04",
    name: "Lô Cà chua Sơ chế R04 (Tách từ R01)",
    status: "Đang chế biến",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 400.0,
    remainingQuantity: 150.0,
    harvestedAt: "2026-10-02",
    parentLotId: "R01",
    createdAt: "2026-10-02T08:00:00.000Z",
  },
  {
    id: "R05",
    name: "Lô Cà chua Sơ chế R05 (Tách từ R01)",
    status: "Đang chế biến",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 400.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-02",
    parentLotId: "R01",
    createdAt: "2026-10-02T08:30:00.000Z",
  },
  {
    id: "R06",
    name: "Lô Cà chua Sơ chế R06 (Tách từ R02)",
    status: "Đang chế biến",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 500.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-02",
    parentLotId: "R02",
    createdAt: "2026-10-02T09:00:00.000Z",
  },
  {
    id: "R07",
    name: "Lô Cà chua Sơ chế R07 (Tách từ R03)",
    status: "Đang chế biến",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 400.0,
    remainingQuantity: 150.0,
    harvestedAt: "2026-10-02",
    parentLotId: "R03",
    createdAt: "2026-10-02T09:30:00.000Z",
  },

  // Tầng 3: Chế biến sâu & Gộp đa nguồn
  {
    id: "R08",
    name: "Lô Cà chua Đóng gói R08 (Gộp R04 + R06)",
    status: "Đang chế biến",
    organizationId: "ORG-B",
    farmId: "FARM-ORG-B",
    productId: "PROD-TOMATO",
    initialQuantity: 500.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-03",
    parentLotId: "R04",
    createdAt: "2026-10-03T08:00:00.000Z",
  },
  {
    id: "R09",
    name: "Lô Cà chua Đóng hộp R09 (Tách từ R05)",
    status: "Đã nhập kho",
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 300.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-03",
    parentLotId: "R05",
    createdAt: "2026-10-03T08:30:00.000Z",
  },
  {
    id: "R10",
    name: "Lô Nước ép Cà chua R10 (Gộp R06 + R07)",
    status: "Đã nhập kho",
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 400.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-03",
    parentLotId: "R06",
    createdAt: "2026-10-03T09:00:00.000Z",
  },

  // Tầng 4: Điểm bán, Kệ hàng & Tiêu thụ
  {
    id: "R11",
    name: "Lô Cà chua Siêu thị R11 (Tách từ R08)",
    status: "Đã bán hết", // S-29 consumed status
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 200.0,
    remainingQuantity: 0.0, // S-29 constraint: 0 remaining
    harvestedAt: "2026-10-04",
    parentLotId: "R08",
    createdAt: "2026-10-04T08:00:00.000Z",
  },
  {
    id: "R12",
    name: "Lô Cà chua Siêu thị R12 (Tách từ R08)",
    status: "Đang lưu kho",
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 200.0,
    remainingQuantity: 200.0, // Tồn kệ cần thu hồi
    harvestedAt: "2026-10-04",
    parentLotId: "R08",
    createdAt: "2026-10-04T08:30:00.000Z",
  },
  {
    id: "R13",
    name: "Lô Cà chua Tiện lợi R13 (Tách từ R09)",
    status: "Đang lưu kho",
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 200.0,
    remainingQuantity: 80.0, // Tồn kệ cần thu hồi
    harvestedAt: "2026-10-04",
    parentLotId: "R09",
    createdAt: "2026-10-04T09:00:00.000Z",
  },
  {
    id: "R14",
    name: "Lô Nước ép Điểm bán R14 (Tách từ R10)",
    status: "Đã bán hết", // S-29 consumed status
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 300.0,
    remainingQuantity: 0.0, // S-29 constraint: 0 remaining
    harvestedAt: "2026-10-04",
    parentLotId: "R10",
    createdAt: "2026-10-04T09:30:00.000Z",
  },
  {
    id: "R15",
    name: "Lô Cà chua Độc lập R15",
    status: "Đã nhập kho",
    organizationId: "ORG-C",
    farmId: null,
    productId: "PROD-TOMATO",
    initialQuantity: 100.0,
    remainingQuantity: 100.0,
    harvestedAt: "2026-10-05",
    parentLotId: null,
    createdAt: "2026-10-05T09:30:00.000Z",
  },
];

/**
 * Danh sách quan hệ phân tách & gộp đa nguồn
 */
const S39_RELATIONS = [
  // Tầng 1 -> Tầng 2
  { id: "rel-s39-01", parentBatchId: "R01", childBatchId: "R04", relationType: "SPLIT", quantity: 400.0, organizationId: "ORG-B" },
  { id: "rel-s39-02", parentBatchId: "R01", childBatchId: "R05", relationType: "SPLIT", quantity: 400.0, organizationId: "ORG-B" },
  { id: "rel-s39-03", parentBatchId: "R02", childBatchId: "R06", relationType: "SPLIT", quantity: 500.0, organizationId: "ORG-B" },
  { id: "rel-s39-04", parentBatchId: "R03", childBatchId: "R07", relationType: "SPLIT", quantity: 400.0, organizationId: "ORG-B" },

  // Tầng 2 -> Tầng 3
  // ⭐ Lô gộp đa nguồn 1: R08 = R04 (250kg) + R06 (250kg)
  { id: "rel-s39-05", parentBatchId: "R04", childBatchId: "R08", relationType: "MERGE", quantity: 250.0, organizationId: "ORG-B" },
  { id: "rel-s39-06", parentBatchId: "R06", childBatchId: "R08", relationType: "MERGE", quantity: 250.0, organizationId: "ORG-B" },
  // Tách R05 -> R09
  { id: "rel-s39-07", parentBatchId: "R05", childBatchId: "R09", relationType: "SPLIT", quantity: 300.0, organizationId: "ORG-C" },
  // ⭐ Lô gộp đa nguồn 2: R10 = R06 (150kg) + R07 (250kg)
  { id: "rel-s39-08", parentBatchId: "R06", childBatchId: "R10", relationType: "MERGE", quantity: 150.0, organizationId: "ORG-C" },
  { id: "rel-s39-09", parentBatchId: "R07", childBatchId: "R10", relationType: "MERGE", quantity: 250.0, organizationId: "ORG-C" },

  // Tầng 3 -> Tầng 4
  { id: "rel-s39-10", parentBatchId: "R08", childBatchId: "R11", relationType: "SPLIT", quantity: 200.0, organizationId: "ORG-C" },
  { id: "rel-s39-11", parentBatchId: "R08", childBatchId: "R12", relationType: "SPLIT", quantity: 200.0, organizationId: "ORG-C" },
  { id: "rel-s39-12", parentBatchId: "R09", childBatchId: "R13", relationType: "SPLIT", quantity: 200.0, organizationId: "ORG-C" },
  { id: "rel-s39-13", parentBatchId: "R10", childBatchId: "R14", relationType: "SPLIT", quantity: 300.0, organizationId: "ORG-C" },
];

/**
 * Định nghĩa các sự kiện theo chuỗi băm SHA-256 (K-01)
 */
const S39_EVENTS_DEFS = [
  // R01
  { batchId: "R01", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-A", actor: "usr-s39-a", date: "2026-10-01T08:00:00.000Z", payload: { initialQuantity: 1000, farmId: "FARM-ORG-A", productId: "PROD-TOMATO" } },
  { batchId: "R01", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-A", actor: "usr-s39-a", date: "2026-10-02T08:00:00.000Z", payload: { childLotId: "R04", splitQuantity: 400, step: "Tách 400kg tạo lô R04" } },
  { batchId: "R01", sequenceNo: 3, eventType: "LOT_SPLIT", org: "ORG-A", actor: "usr-s39-a", date: "2026-10-02T08:30:00.000Z", payload: { childLotId: "R05", splitQuantity: 400, step: "Tách 400kg tạo lô R05" } },

  // R02
  { batchId: "R02", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-A", actor: "usr-s39-a", date: "2026-10-01T08:30:00.000Z", payload: { initialQuantity: 800, farmId: "FARM-ORG-A", productId: "PROD-TOMATO" } },
  { batchId: "R02", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-A", actor: "usr-s39-a", date: "2026-10-02T09:00:00.000Z", payload: { childLotId: "R06", splitQuantity: 500, step: "Tách 500kg tạo lô R06" } },

  // R03
  { batchId: "R03", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-01T09:00:00.000Z", payload: { initialQuantity: 500, farmId: "FARM-ORG-B", productId: "PROD-TOMATO" } },
  { batchId: "R03", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-02T09:30:00.000Z", payload: { childLotId: "R07", splitQuantity: 400, step: "Tách 400kg tạo lô R07" } },

  // R04
  { batchId: "R04", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-02T08:00:00.000Z", payload: { parentLotId: "R01", initialQuantity: 400, step: "Khởi tạo từ tách lô R01" } },
  { batchId: "R04", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T08:00:00.000Z", payload: { targetLotId: "R08", takeQuantity: 250, step: "Gộp 250kg vào lô R08" } },

  // R05
  { batchId: "R05", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-02T08:30:00.000Z", payload: { parentLotId: "R01", initialQuantity: 400, step: "Khởi tạo từ tách lô R01" } },
  { batchId: "R05", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T08:30:00.000Z", payload: { childLotId: "R09", splitQuantity: 300, step: "Tách 300kg tạo lô R09" } },

  // R06
  { batchId: "R06", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-02T09:00:00.000Z", payload: { parentLotId: "R02", initialQuantity: 500, step: "Khởi tạo từ tách lô R02" } },
  { batchId: "R06", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T08:00:00.000Z", payload: { targetLotId: "R08", takeQuantity: 250, step: "Gộp 250kg vào lô R08" } },
  { batchId: "R06", sequenceNo: 3, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T09:00:00.000Z", payload: { targetLotId: "R10", takeQuantity: 150, step: "Gộp 150kg vào lô R10" } },

  // R07
  { batchId: "R07", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-02T09:30:00.000Z", payload: { parentLotId: "R03", initialQuantity: 400, step: "Khởi tạo từ tách lô R03" } },
  { batchId: "R07", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T09:00:00.000Z", payload: { targetLotId: "R10", takeQuantity: 250, step: "Gộp 250kg vào lô R10" } },

  // R08 (Gộp R04 + R06)
  { batchId: "R08", sequenceNo: 1, eventType: "CREATED_FROM_MERGE", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-03T08:00:00.000Z", payload: { totalQuantity: 500, parentLots: [{ parentBatchId: "R04", quantity: 250 }, { parentBatchId: "R06", quantity: 250 }], step: "Gộp từ R04 và R06" } },
  { batchId: "R08", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-04T08:00:00.000Z", payload: { childLotId: "R11", splitQuantity: 200, step: "Tách 200kg tạo lô R11" } },
  { batchId: "R08", sequenceNo: 3, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s39-b", date: "2026-10-04T08:30:00.000Z", payload: { childLotId: "R12", splitQuantity: 200, step: "Tách 200kg tạo lô R12" } },

  // R09
  { batchId: "R09", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-03T08:30:00.000Z", payload: { parentLotId: "R05", initialQuantity: 300, step: "Khởi tạo từ tách lô R05" } },
  { batchId: "R09", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T09:00:00.000Z", payload: { childLotId: "R13", splitQuantity: 200, step: "Tách 200kg tạo lô R13" } },

  // R10 (Gộp R06 + R07)
  { batchId: "R10", sequenceNo: 1, eventType: "CREATED_FROM_MERGE", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-03T09:00:00.000Z", payload: { totalQuantity: 400, parentLots: [{ parentBatchId: "R06", quantity: 150 }, { parentBatchId: "R07", quantity: 250 }], step: "Gộp từ R06 và R07" } },
  { batchId: "R10", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T09:30:00.000Z", payload: { childLotId: "R14", splitQuantity: 300, step: "Tách 300kg tạo lô R14" } },

  // R11 (S-29: Tiêu thụ hết)
  { batchId: "R11", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T08:00:00.000Z", payload: { parentLotId: "R08", initialQuantity: 200, step: "Khởi tạo từ tách lô R08" } },
  { batchId: "R11", sequenceNo: 2, eventType: "LOT_CONSUMED", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-05T08:00:00.000Z", payload: { previousStatus: "Đã nhập kho", consumedQuantity: 200, notes: "Đã phân phối hết tại siêu thị A tới tay người tiêu dùng" } },

  // R12 (Tồn kệ cần thu hồi)
  { batchId: "R12", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T08:30:00.000Z", payload: { parentLotId: "R08", initialQuantity: 200, step: "Khởi tạo từ tách lô R08" } },

  // R13 (Tồn kệ cần thu hồi)
  { batchId: "R13", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T09:00:00.000Z", payload: { parentLotId: "R09", initialQuantity: 200, step: "Khởi tạo từ tách lô R09" } },

  // R14 (S-29: Tiêu thụ hết)
  { batchId: "R14", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-04T09:30:00.000Z", payload: { parentLotId: "R10", initialQuantity: 300, step: "Khởi tạo từ tách lô R10" } },
  { batchId: "R14", sequenceNo: 2, eventType: "LOT_CONSUMED", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-05T09:00:00.000Z", payload: { previousStatus: "Đã nhập kho", consumedQuantity: 300, notes: "Đã bán hết tại quầy nước giải khát D" } },

  // R15 (Độc lập biên)
  { batchId: "R15", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-C", actor: "usr-s39-c", date: "2026-10-05T09:30:00.000Z", payload: { initialQuantity: 100, productId: "PROD-TOMATO" } },
];

/**
 * Xây dựng danh sách sự kiện kèm SHA-256 hash
 */
function buildS39EventsWithHashes() {
  const chainMap = new Map();
  const result = [];

  for (const ed of S39_EVENTS_DEFS) {
    if (!chainMap.has(ed.batchId)) chainMap.set(ed.batchId, []);
    const list = chainMap.get(ed.batchId);
    const prevHash = list.length === 0 ? GENESIS_HASH : list[list.length - 1].eventHash;

    const eventHash = calculateEventHash(prevHash, {
      batchId: ed.batchId,
      sequenceNo: ed.sequenceNo,
      eventType: ed.eventType,
      payload: ed.payload,
      organizationId: ed.org,
      actorUserId: ed.actor,
      occurredAt: ed.date,
    });

    const evObj = {
      id: `evt-s39-${ed.batchId.toLowerCase()}-0${ed.sequenceNo}`,
      batchId: ed.batchId,
      sequenceNo: ed.sequenceNo,
      eventType: ed.eventType,
      payload: ed.payload,
      organizationId: ed.org,
      actorUserId: ed.actor,
      occurredAt: ed.date,
      previousHash: prevHash,
      eventHash,
      createdAt: ed.date,
    };

    list.push(evObj);
    result.push(evObj);
  }

  return result;
}

/**
 * Nạp dữ liệu S-39 vào bộ nhớ in-memory (Dùng cho unit test & offline test)
 */
function seedS39InMemory(target = {}) {
  const lots = target.inMemoryLots || [];
  const relations = target.inMemoryBatchRelations || [];
  const events = target.inMemoryBatchEvents || [];
  const orgs = target.inMemoryOrgs || [];
  const products = target.inMemoryProducts || [];
  const farms = target.inMemoryFarms || [];

  // Orgs
  const s39Orgs = [
    { id: "ORG-A", name: "Hợp tác xã Nông nghiệp A", type: "cooperative" },
    { id: "ORG-B", name: "Nhà máy/đơn vị sơ chế B", type: "producer" },
    { id: "ORG-C", name: "Trung tâm phân phối C", type: "distributor" },
  ];
  for (const o of s39Orgs) {
    const idx = orgs.findIndex((x) => x.id === o.id);
    if (idx >= 0) orgs[idx] = o;
    else orgs.push(o);
  }

  // Products
  if (!products.some((p) => p.id === "PROD-TOMATO")) {
    products.push({ id: "PROD-TOMATO", name: "Cà chua", unit: "kg" });
  }

  // Farms
  const s39Farms = [
    { id: "FARM-ORG-A", name: "Thửa canh tác Hợp tác xã A", area: 3.5, coordinates: "21.5645, 105.6789", organization_id: "ORG-A" },
    { id: "FARM-ORG-B", name: "Thửa sơ chế Nhà máy B", area: 2.0, coordinates: "21.5712, 105.6841", organization_id: "ORG-B" },
  ];
  for (const f of s39Farms) {
    const idx = farms.findIndex((x) => x.id === f.id);
    if (idx >= 0) farms[idx] = f;
    else farms.push(f);
  }

  // Lots
  for (const l of S39_LOTS) {
    const idx = lots.findIndex((x) => x.id === l.id);
    if (idx >= 0) lots[idx] = { ...l };
    else lots.push({ ...l });
  }

  // Relations
  for (const r of S39_RELATIONS) {
    const idx = relations.findIndex(
      (x) =>
        (x.parentBatchId || x.parent_batch_id) === r.parentBatchId &&
        (x.childBatchId || x.child_batch_id) === r.childBatchId
    );
    if (idx >= 0) relations[idx] = { ...r };
    else relations.push({ ...r });
  }

  // Events with cryptographic hash chains
  const generatedEvents = buildS39EventsWithHashes();
  for (const ev of generatedEvents) {
    const idx = events.findIndex(
      (x) =>
        (x.batchId || x.batch_id) === ev.batchId &&
        Number(x.sequenceNo || x.sequence_no) === ev.sequenceNo
    );
    if (idx >= 0) events[idx] = { ...ev };
    else events.push({ ...ev });
  }

  return {
    lotsCount: S39_LOTS.length,
    relationsCount: S39_RELATIONS.length,
    eventsCount: generatedEvents.length,
  };
}

/**
 * Sinh file db/seed_s39.sql với đầy đủ dữ liệu và mã hash SHA-256 chính xác
 */
function generateS39Sql() {
  const events = buildS39EventsWithHashes();

  const lotsSqlValues = S39_LOTS.map((l) => {
    const farmVal = l.farmId ? `'${l.farmId}'` : "NULL";
    const parentVal = l.parentLotId ? `'${l.parentLotId}'` : "NULL";
    return `    ('${l.id}', '${l.name}', '${l.status}', '${l.organizationId}', ${farmVal}, '${l.productId}', ${l.initialQuantity.toFixed(3)}, ${l.remainingQuantity.toFixed(3)}, '${l.harvestedAt}', ${parentVal}, '${l.createdAt}')`;
  }).join(",\n");

  const relsSqlValues = S39_RELATIONS.map((r) => {
    return `    ('${r.id}', '${r.parentBatchId}', '${r.childBatchId}', '${r.relationType}', ${r.quantity.toFixed(3)}, '${r.organizationId}', CURRENT_TIMESTAMP)`;
  }).join(",\n");

  const eventsSqlValues = events.map((e) => {
    const payloadJson = JSON.stringify(e.payload).replace(/'/g, "''");
    return `    ('${e.id}', '${e.batchId}', ${e.sequenceNo}, '${e.eventType}', '${payloadJson}'::jsonb, '${e.organizationId}', '${e.actorUserId}', '${e.occurredAt}', '${e.previousHash}', '${e.eventHash}')`;
  }).join(",\n");

  const sqlContent = `-- ============================================================================
-- S-39: BỘ DỮ LIỆU THU HỒI MẪU BỐN TẦNG, BA TỔ CHỨC, CÓ ĐÁP ÁN ĐẾM TAY (IDEMPOTENT)
-- ============================================================================
-- Tiêu chí chấp nhận (Acceptance Criteria):
-- AC1: Đồ thị bốn tầng qua ba tổ chức với ít nhất một lô gộp đa nguồn và một lô đã tiêu thụ.
-- AC2: Đáp án đối chiếu đếm tay độc lập từ hai người theo bảng tra cứu lô gốc.
-- Dependencies: S-22, S-29 (Trạng thái 'Đã bán hết' và remaining_quantity = 0).
-- ============================================================================

-- 1. Ba tổ chức (Organizations)
INSERT INTO organizations (id, name, type) VALUES
    ('ORG-A', 'Hợp tác xã Nông nghiệp A', 'cooperative'),
    ('ORG-B', 'Nhà máy/đơn vị sơ chế B', 'producer'),
    ('ORG-C', 'Trung tâm phân phối C', 'distributor')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- 2. Sản phẩm (Products)
INSERT INTO products (id, name, unit) VALUES
    ('PROD-TOMATO', 'Cà chua', 'kg')
ON CONFLICT (id) DO NOTHING;

-- 3. Thửa đất / Vùng sản xuất (Farms)
INSERT INTO farms (id, name, area, coordinates, organization_id) VALUES
    ('FARM-ORG-A', 'Thửa canh tác Hợp tác xã A', 3.50, '21.5645, 105.6789', 'ORG-A'),
    ('FARM-ORG-B', 'Thửa sơ chế Nhà máy B', 2.00, '21.5712, 105.6841', 'ORG-B')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    area = EXCLUDED.area,
    organization_id = EXCLUDED.organization_id;

-- 4. 15 lô hàng qua 4 tầng (Lots)
INSERT INTO lots (
    id, name, status, organization_id, farm_id, product_id,
    initial_quantity, remaining_quantity, harvested_at, parent_lot_id, created_at
) VALUES
${lotsSqlValues}
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    organization_id = EXCLUDED.organization_id,
    farm_id = EXCLUDED.farm_id,
    product_id = EXCLUDED.product_id,
    initial_quantity = EXCLUDED.initial_quantity,
    remaining_quantity = EXCLUDED.remaining_quantity,
    harvested_at = EXCLUDED.harvested_at,
    parent_lot_id = EXCLUDED.parent_lot_id;

-- 5. Quan hệ phân tách và sáp nhập (Batch Relations)
INSERT INTO batch_relations (
    id, parent_batch_id, child_batch_id, relation_type, quantity, organization_id, created_at
) VALUES
${relsSqlValues}
ON CONFLICT (parent_batch_id, child_batch_id) DO UPDATE SET
    relation_type = EXCLUDED.relation_type,
    quantity = EXCLUDED.quantity,
    organization_id = EXCLUDED.organization_id;

-- 6. Chuỗi sự kiện toàn vẹn mật mã SHA-256 (Batch Events)
INSERT INTO batch_events (
    id, batch_id, sequence_no, event_type, payload, organization_id,
    actor_user_id, occurred_at, previous_hash, event_hash
) VALUES
${eventsSqlValues}
ON CONFLICT (batch_id, sequence_no) DO UPDATE SET
    event_type = EXCLUDED.event_type,
    payload = EXCLUDED.payload,
    organization_id = EXCLUDED.organization_id,
    actor_user_id = EXCLUDED.actor_user_id,
    occurred_at = EXCLUDED.occurred_at,
    previous_hash = EXCLUDED.previous_hash,
    event_hash = EXCLUDED.event_hash;
`;

  fs.writeFileSync(SEED_FILE, sqlContent, "utf-8");
  return { success: true, path: SEED_FILE };
}

/**
 * Thực thi seed vào PostgreSQL database
 */
async function seedS39Postgres(poolInstance) {
  if (!fs.existsSync(SEED_FILE)) {
    generateS39Sql();
  }
  const pool = poolInstance || getPool();
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(SEED_FILE, "utf-8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[Seed S-39] Applied db/seed_s39.sql successfully to PostgreSQL database.");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Seed S-39 Error]", err.message);
    throw err;
  } finally {
    client.release();
    if (!poolInstance) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  generateS39Sql();
  console.log("[Seed S-39] Generated db/seed_s39.sql successfully.");
  if (process.argv.includes("--postgres")) {
    seedS39Postgres()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}

module.exports = {
  S39_LOTS,
  S39_RELATIONS,
  S39_EVENTS_DEFS,
  buildS39EventsWithHashes,
  seedS39InMemory,
  seedS39Postgres,
  generateS39Sql,
};
