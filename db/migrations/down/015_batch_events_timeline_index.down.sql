-- Rollback Migration 015: Drop composite index idx_batch_events_batch_occurred (T-23 / S-10)
DROP INDEX IF EXISTS idx_batch_events_batch_occurred;
