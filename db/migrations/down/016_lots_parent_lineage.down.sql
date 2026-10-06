-- Rollback Migration 016: Drop index and parent_lot_id column from lots table
DROP INDEX IF EXISTS idx_lots_parent_lot_id;
ALTER TABLE lots DROP COLUMN IF EXISTS parent_lot_id;
