const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { calculateEventHash, GENESIS_HASH } = require("../src/integrity");

const SEED_FILE = path.resolve(__dirname, "../../db/seed_s22.sql");

function getPool() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || "postgres"}:${process.env.POSTGRES_PASSWORD || "postgres"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "agri_trace"}`;
  return new Pool({ connectionString });
}

/**
 * Execute db/seed_s22.sql against PostgreSQL database idempotently.
 */
async function seedS22Postgres(poolInstance) {
  const pool = poolInstance || getPool();
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(SEED_FILE, "utf-8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[Seed S-22] Applied db/seed_s22.sql successfully to PostgreSQL database.");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Seed S-22 Error]", err.message);
    throw err;
  } finally {
    client.release();
    if (!poolInstance) {
      await pool.end();
    }
  }
}

/**
 * Populate in-memory arrays with S-22 sample data.
 */
function seedS22InMemory(target = {}) {
  const lots = target.inMemoryLots || [];
  const relations = target.inMemoryBatchRelations || [];
  const events = target.inMemoryBatchEvents || [];
  const orgs = target.inMemoryOrgs || [];
  const products = target.inMemoryProducts || [];
  const farms = target.inMemoryFarms || [];

  // Orgs
  const s22Orgs = [
    { id: "ORG-A", name: "Hợp tác xã Nông nghiệp A", type: "cooperative" },
    { id: "ORG-B", name: "Nhà máy/đơn vị sơ chế B", type: "producer" },
    { id: "ORG-C", name: "Trung tâm phân phối C", type: "distributor" },
  ];
  for (const o of s22Orgs) {
    const idx = orgs.findIndex((x) => x.id === o.id);
    if (idx >= 0) orgs[idx] = o;
    else orgs.push(o);
  }

  // Products
  if (!products.some((p) => p.id === "PROD-TOMATO")) {
    products.push({ id: "PROD-TOMATO", name: "Cà chua", unit: "kg" });
  }

  // Farms
  const s22Farms = [
    { id: "FARM-ORG-A", name: "Thửa canh tác Hợp tác xã A", area: 3.5, coordinates: "21.5645, 105.6789", organization_id: "ORG-A" },
    { id: "FARM-ORG-B", name: "Thửa sơ chế Nhà máy B", area: 2.0, coordinates: "21.5712, 105.6841", organization_id: "ORG-B" }
  ];
  for (const f of s22Farms) {
    const idx = farms.findIndex((x) => x.id === f.id);
    if (idx >= 0) farms[idx] = f;
    else farms.push(f);
  }

  // Lots
  const s22Lots = [
    { id: "L01", name: "Lô Cà chua Nguồn L01", status: "Đã thu hoạch", organizationId: "ORG-A", farmId: "FARM-ORG-A", productId: "PROD-TOMATO", initialQuantity: 500, remainingQuantity: 300, harvestedAt: "2026-10-01", parentLotId: null, createdAt: "2026-10-01T08:00:00.000Z" },
    { id: "L02", name: "Lô Cà chua Nguồn L02", status: "Đã thu hoạch", organizationId: "ORG-A", farmId: "FARM-ORG-A", productId: "PROD-TOMATO", initialQuantity: 600, remainingQuantity: 200, harvestedAt: "2026-10-01", parentLotId: null, createdAt: "2026-10-01T08:30:00.000Z" },
    { id: "L03", name: "Lô Cà chua Nguồn L03", status: "Đã thu hoạch", organizationId: "ORG-A", farmId: "FARM-ORG-A", productId: "PROD-TOMATO", initialQuantity: 400, remainingQuantity: 200, harvestedAt: "2026-10-01", parentLotId: null, createdAt: "2026-10-01T09:00:00.000Z" },
    { id: "L04", name: "Lô Cà chua Nguồn L04", status: "Đã thu hoạch", organizationId: "ORG-B", farmId: "FARM-ORG-B", productId: "PROD-TOMATO", initialQuantity: 500, remainingQuantity: 100, harvestedAt: "2026-10-02", parentLotId: null, createdAt: "2026-10-02T08:00:00.000Z" },
    { id: "L05", name: "Lô Cà chua Sơ chế L05 (Tách từ L02)", status: "Đã thu hoạch", organizationId: "ORG-B", farmId: "FARM-ORG-B", productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 100, harvestedAt: "2026-10-03", parentLotId: "L02", createdAt: "2026-10-03T08:00:00.000Z" },
    { id: "L06", name: "Lô Cà chua Sơ chế L06 (Tách từ L02)", status: "Đã thu hoạch", organizationId: "ORG-B", farmId: "FARM-ORG-B", productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 100, harvestedAt: "2026-10-03", parentLotId: "L02", createdAt: "2026-10-03T08:30:00.000Z" },
    { id: "L07", name: "Lô Cà chua Gộp L07 (Gộp L01 + L03)", status: "Đã thu hoạch", organizationId: "ORG-B", farmId: "FARM-ORG-B", productId: "PROD-TOMATO", initialQuantity: 400, remainingQuantity: 400, harvestedAt: "2026-10-03", parentLotId: "L01", createdAt: "2026-10-03T09:00:00.000Z" },
    { id: "L08", name: "Lô Cà chua Phân phối L08 (Tách từ L04)", status: "Đã thu hoạch", organizationId: "ORG-C", farmId: null, productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 100, harvestedAt: "2026-10-04", parentLotId: "L04", createdAt: "2026-10-04T08:00:00.000Z" },
    { id: "L09", name: "Lô Cà chua Phân phối L09 (Tách từ L04)", status: "Đã thu hoạch", organizationId: "ORG-C", farmId: null, productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 100, harvestedAt: "2026-10-04", parentLotId: "L04", createdAt: "2026-10-04T08:30:00.000Z" },
    { id: "L10", name: "Lô Cà chua Gộp L10 (Gộp L05 + L08)", status: "Đã thu hoạch", organizationId: "ORG-C", farmId: null, productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 200, harvestedAt: "2026-10-05", parentLotId: "L05", createdAt: "2026-10-05T08:00:00.000Z" },
    { id: "L11", name: "Lô Cà chua Gộp L11 (Gộp L06 + L09)", status: "Đã thu hoạch", organizationId: "ORG-C", farmId: null, productId: "PROD-TOMATO", initialQuantity: 200, remainingQuantity: 200, harvestedAt: "2026-10-05", parentLotId: "L06", createdAt: "2026-10-05T08:30:00.000Z" },
    { id: "L12", name: "Lô Cà chua Độc lập L12", status: "Đã thu hoạch", organizationId: "ORG-C", farmId: null, productId: "PROD-TOMATO", initialQuantity: 150, remainingQuantity: 150, harvestedAt: "2026-10-05", parentLotId: null, createdAt: "2026-10-05T09:00:00.000Z" },
  ];
  for (const l of s22Lots) {
    const idx = lots.findIndex((x) => x.id === l.id);
    if (idx >= 0) lots[idx] = l;
    else lots.push(l);
  }

  // Relations
  const s22Rels = [
    { id: "rel-s22-01", parentBatchId: "L02", childBatchId: "L05", relationType: "SPLIT", quantity: 200, organizationId: "ORG-B" },
    { id: "rel-s22-02", parentBatchId: "L02", childBatchId: "L06", relationType: "SPLIT", quantity: 200, organizationId: "ORG-B" },
    { id: "rel-s22-03", parentBatchId: "L01", childBatchId: "L07", relationType: "MERGE", quantity: 200, organizationId: "ORG-B" },
    { id: "rel-s22-04", parentBatchId: "L03", childBatchId: "L07", relationType: "MERGE", quantity: 200, organizationId: "ORG-B" },
    { id: "rel-s22-05", parentBatchId: "L04", childBatchId: "L08", relationType: "SPLIT", quantity: 200, organizationId: "ORG-C" },
    { id: "rel-s22-06", parentBatchId: "L04", childBatchId: "L09", relationType: "SPLIT", quantity: 200, organizationId: "ORG-C" },
    { id: "rel-s22-07", parentBatchId: "L05", childBatchId: "L10", relationType: "MERGE", quantity: 100, organizationId: "ORG-C" },
    { id: "rel-s22-08", parentBatchId: "L08", childBatchId: "L10", relationType: "MERGE", quantity: 100, organizationId: "ORG-C" },
    { id: "rel-s22-09", parentBatchId: "L06", childBatchId: "L11", relationType: "MERGE", quantity: 100, organizationId: "ORG-C" },
    { id: "rel-s22-10", parentBatchId: "L09", childBatchId: "L11", relationType: "MERGE", quantity: 100, organizationId: "ORG-C" },
  ];
  for (const r of s22Rels) {
    const idx = relations.findIndex(
      (x) => (x.parentBatchId || x.parent_batch_id) === r.parentBatchId && (x.childBatchId || x.child_batch_id) === r.childBatchId
    );
    if (idx >= 0) relations[idx] = r;
    else relations.push(r);
  }

  // Events definition
  const eventsDefs = [
    { batchId: "L01", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-01T08:00:00.000Z", payload: { initialQuantity: 500, farmId: "FARM-ORG-A", productId: "PROD-TOMATO" } },
    { batchId: "L01", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-03T09:00:00.000Z", payload: { targetLotId: "L07", takeQuantity: 200, step: "Gộp 200 vào lô L07" } },
    { batchId: "L02", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-01T08:30:00.000Z", payload: { initialQuantity: 600, farmId: "FARM-ORG-A", productId: "PROD-TOMATO" } },
    { batchId: "L02", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-03T08:00:00.000Z", payload: { childLotId: "L05", splitQuantity: 200, step: "Tách 200 tạo lô L05" } },
    { batchId: "L02", sequenceNo: 3, eventType: "LOT_SPLIT", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-03T08:30:00.000Z", payload: { childLotId: "L06", splitQuantity: 200, step: "Tách 200 tạo lô L06" } },
    { batchId: "L03", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-01T09:00:00.000Z", payload: { initialQuantity: 400, farmId: "FARM-ORG-A", productId: "PROD-TOMATO" } },
    { batchId: "L03", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-A", actor: "usr-s22-a", date: "2026-10-03T09:00:00.000Z", payload: { targetLotId: "L07", takeQuantity: 200, step: "Gộp 200 vào lô L07" } },
    { batchId: "L04", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-02T08:00:00.000Z", payload: { initialQuantity: 500, farmId: "FARM-ORG-B", productId: "PROD-TOMATO" } },
    { batchId: "L04", sequenceNo: 2, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-04T08:00:00.000Z", payload: { childLotId: "L08", splitQuantity: 200, step: "Tách 200 tạo lô L08" } },
    { batchId: "L04", sequenceNo: 3, eventType: "LOT_SPLIT", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-04T08:30:00.000Z", payload: { childLotId: "L09", splitQuantity: 200, step: "Tách 200 tạo lô L09" } },
    { batchId: "L05", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-03T08:00:00.000Z", payload: { parentLotId: "L02", initialQuantity: 200, step: "Khởi tạo từ tách lô L02" } },
    { batchId: "L05", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-05T08:00:00.000Z", payload: { targetLotId: "L10", takeQuantity: 100, step: "Gộp 100 vào lô L10" } },
    { batchId: "L06", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-03T08:30:00.000Z", payload: { parentLotId: "L02", initialQuantity: 200, step: "Khởi tạo từ tách lô L02" } },
    { batchId: "L06", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-05T08:30:00.000Z", payload: { targetLotId: "L11", takeQuantity: 100, step: "Gộp 100 vào lô L11" } },
    { batchId: "L07", sequenceNo: 1, eventType: "CREATED_FROM_MERGE", org: "ORG-B", actor: "usr-s22-b", date: "2026-10-03T09:00:00.000Z", payload: { totalQuantity: 400, parentLots: [{ parentBatchId: "L01", quantity: 200 }, { parentBatchId: "L03", quantity: 200 }], step: "Gộp từ L01 và L03" } },
    { batchId: "L08", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-04T08:00:00.000Z", payload: { parentLotId: "L04", initialQuantity: 200, step: "Khởi tạo từ tách lô L04" } },
    { batchId: "L08", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-05T08:00:00.000Z", payload: { targetLotId: "L10", takeQuantity: 100, step: "Gộp 100 vào lô L10" } },
    { batchId: "L09", sequenceNo: 1, eventType: "CREATED_FROM_SPLIT", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-04T08:30:00.000Z", payload: { parentLotId: "L04", initialQuantity: 200, step: "Khởi tạo từ tách lô L04" } },
    { batchId: "L09", sequenceNo: 2, eventType: "LOT_MERGED_FROM", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-05T08:30:00.000Z", payload: { targetLotId: "L11", takeQuantity: 100, step: "Gộp 100 vào lô L11" } },
    { batchId: "L10", sequenceNo: 1, eventType: "CREATED_FROM_MERGE", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-05T08:00:00.000Z", payload: { totalQuantity: 200, parentLots: [{ parentBatchId: "L05", quantity: 100 }, { parentBatchId: "L08", quantity: 100 }], step: "Gộp từ L05 và L08" } },
    { batchId: "L11", sequenceNo: 1, eventType: "CREATED_FROM_MERGE", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-05T08:30:00.000Z", payload: { totalQuantity: 200, parentLots: [{ parentBatchId: "L06", quantity: 100 }, { parentBatchId: "L09", quantity: 100 }], step: "Gộp từ L06 và L09" } },
    { batchId: "L12", sequenceNo: 1, eventType: "HARVEST_CREATED", org: "ORG-C", actor: "usr-s22-c", date: "2026-10-05T09:00:00.000Z", payload: { initialQuantity: 150, productId: "PROD-TOMATO" } },
  ];

  const chainMap = new Map();
  for (const ed of eventsDefs) {
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
      id: `evt-s22-${ed.batchId.toLowerCase()}-0${ed.sequenceNo}`,
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

    const idx = events.findIndex(
      (e) => (e.batchId || e.batch_id) === ed.batchId && (e.sequenceNo || e.sequence_no) === ed.sequenceNo
    );
    if (idx >= 0) events[idx] = evObj;
    else events.push(evObj);
  }

  return { lots, relations, events, orgs, products, farms };
}

if (require.main === module) {
  seedS22Postgres()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  seedS22Postgres,
  seedS22InMemory,
};
