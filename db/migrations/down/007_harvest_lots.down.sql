-- Down Migration 007: Revert harvest lot expansions
ALTER TABLE lots DROP CONSTRAINT IF EXISTS chk_lots_remaining_quantity;
ALTER TABLE lots DROP CONSTRAINT IF EXISTS chk_lots_initial_quantity;
DROP INDEX IF EXISTS idx_lots_product_id;
ALTER TABLE lots DROP COLUMN IF EXISTS harvested_at;
ALTER TABLE lots DROP COLUMN IF EXISTS remaining_quantity;
ALTER TABLE lots DROP COLUMN IF EXISTS initial_quantity;
ALTER TABLE lots DROP COLUMN IF EXISTS product_id;
