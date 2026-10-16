-- Migration Down 024: Rollback shipments and shipment_lots tables
DROP TABLE IF EXISTS shipment_lots CASCADE;
DROP TABLE IF EXISTS shipments CASCADE;
