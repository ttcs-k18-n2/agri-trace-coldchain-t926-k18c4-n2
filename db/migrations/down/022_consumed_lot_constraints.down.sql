-- Rollback migration 022
ALTER TABLE lots DROP CONSTRAINT IF EXISTS chk_consumed_remaining_zero;
