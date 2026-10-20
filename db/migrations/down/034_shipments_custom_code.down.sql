-- Rollback Migration 034: Custom Shipment Code Persistence & Uniqueness
DROP INDEX IF EXISTS idx_shipments_shipment_code;
ALTER TABLE shipments DROP COLUMN IF EXISTS shipment_code;
