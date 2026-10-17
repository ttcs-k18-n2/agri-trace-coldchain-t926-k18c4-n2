-- Migration Down 025: Drop unique active shipment cold box index safely
-- Drops ONLY idx_unique_active_shipment_per_cold_box.
-- Never drops shipments or shipment_lots tables, preserving all business data.
DROP INDEX IF EXISTS idx_unique_active_shipment_per_cold_box;
