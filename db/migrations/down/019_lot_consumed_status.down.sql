-- Migration 018: Rollback index on lots status for recall and consumption tracking (S-29)
DROP INDEX IF EXISTS idx_lots_org_status;
DROP INDEX IF EXISTS idx_lots_status;
