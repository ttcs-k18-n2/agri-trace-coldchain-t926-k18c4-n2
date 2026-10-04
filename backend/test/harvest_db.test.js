const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Pool } = require("pg");
const { app, setDatabasePool } = require("../src/server");

test(
  "S-08 DB integration: authenticated producer can create a harvest lot on PostgreSQL",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    setDatabasePool(pool);

    let createdLotId = null;
    t.after(async () => {
      if (createdLotId) {
        await pool.query("DELETE FROM lots WHERE id = $1", [createdLotId]);
      }
      setDatabasePool(null);
      await pool.end();
    });

    const agent = request.agent(app);

    const login = await agent
      .post("/api/login")
      .send({ email: "user@example.com", password: "Password@123" });

    assert.equal(login.status, 200, login.text);

    const products = await agent.get("/api/products");
    assert.equal(products.status, 200, products.text);
    assert.ok(products.body.products.some((p) => p.id === "PROD-TEA"));

    const farms = await agent.get("/api/farms");
    assert.equal(farms.status, 200, farms.text);
    assert.ok(farms.body.farms.some((f) => f.id === "FARM-001"));

    const harvest = await agent.post("/api/lots").send({
      farmId: "FARM-001",
      productId: "PROD-TEA",
      quantity: 12.345,
      harvestedAt: "2026-10-04",
      name: "CI harvest integration test",
    });

    assert.equal(harvest.status, 201, harvest.text);
    createdLotId = harvest.body.lot.id;

    assert.match(createdLotId, /^LOT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(harvest.body.lot.organizationId, "org-001");
    assert.equal(harvest.body.lot.farmId, "FARM-001");
    assert.equal(harvest.body.lot.productId, "PROD-TEA");
    assert.equal(harvest.body.lot.initialQuantity, 12.345);
    assert.equal(harvest.body.lot.remainingQuantity, 12.345);

    const persisted = await pool.query(
      "SELECT organization_id, farm_id, product_id, initial_quantity, remaining_quantity FROM lots WHERE id = $1",
      [createdLotId]
    );

    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0].organization_id, "org-001");
    assert.equal(persisted.rows[0].farm_id, "FARM-001");
    assert.equal(persisted.rows[0].product_id, "PROD-TEA");
    assert.equal(Number(persisted.rows[0].initial_quantity), 12.345);
    assert.equal(Number(persisted.rows[0].remaining_quantity), 12.345);
  }
);
