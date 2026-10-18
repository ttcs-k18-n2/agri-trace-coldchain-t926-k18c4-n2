-- Rollback Migration 033
DROP TABLE IF EXISTS farmer_anonymization_requests;
ALTER TABLE farms DROP COLUMN IF EXISTS anonymized_at;
ALTER TABLE farms DROP COLUMN IF EXISTS is_anonymized;
ALTER TABLE farms DROP COLUMN IF EXISTS farmer_address;
ALTER TABLE farms DROP COLUMN IF EXISTS farmer_phone;
ALTER TABLE farms DROP COLUMN IF EXISTS farmer_name;
