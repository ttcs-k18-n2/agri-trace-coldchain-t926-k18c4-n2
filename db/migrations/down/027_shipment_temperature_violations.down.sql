-- Rollback Migration 027: Shipment Temperature Violations (Story S-43)
DROP TABLE IF EXISTS temperature_violations CASCADE;
ALTER TABLE shipments DROP COLUMN IF EXISTS detector_state;
