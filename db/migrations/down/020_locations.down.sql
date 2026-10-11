-- Rollback migration 020
ALTER TABLE lots DROP COLUMN IF EXISTS location_id;
DROP TABLE IF EXISTS locations CASCADE;
