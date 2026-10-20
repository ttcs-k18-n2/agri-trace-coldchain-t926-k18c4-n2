-- Migration 034: Custom Shipment Code Persistence & Uniqueness (S-40 Refinement)
-- Đồng bộ mã chuyến tự sinh/nhập thủ công từ frontend và lưu trữ duy nhất trong CSDL.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_shipment_code
ON shipments (shipment_code)
WHERE shipment_code IS NOT NULL;
