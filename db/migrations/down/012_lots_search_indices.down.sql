-- Rollback Migration 012: lots search indices
DROP INDEX IF EXISTS idx_lots_org_harvest_created_id;
DROP INDEX IF EXISTS idx_lots_org_product_harvest;
