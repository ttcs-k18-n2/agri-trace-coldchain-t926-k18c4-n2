-- Revert Migration 013: Lot Transfers Table
DROP INDEX IF EXISTS idx_unique_pending_transfer_per_lot;
DROP TABLE IF EXISTS lot_transfers;
