-- Rollback Migration 014: Add overdue tracking to lot_transfers
DROP INDEX IF EXISTS idx_lot_transfers_overdue_scan;
ALTER TABLE lot_transfers DROP COLUMN IF EXISTS overdue_at;
ALTER TABLE lot_transfers DROP COLUMN IF EXISTS is_overdue;
