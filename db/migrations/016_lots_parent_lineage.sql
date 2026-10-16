-- Migration 016: Add parent_lot_id column and index to lots table for direct parent-child lineage
ALTER TABLE lots
ADD COLUMN IF NOT EXISTS parent_lot_id VARCHAR(50) REFERENCES lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lots_parent_lot_id ON lots(parent_lot_id);
