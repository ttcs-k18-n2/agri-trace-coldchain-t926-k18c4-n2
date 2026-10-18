-- Migration 033: Cơ chế xóa dữ liệu định danh nông hộ tuân thủ Nghị định 13/2023/NĐ-CP (Story S-56 / Epic E-10)

-- Bổ sung trường thông tin định danh cá nhân và trạng thái ẩn danh vào bảng farms
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_name VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_phone VARCHAR(32);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_address TEXT;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS is_anonymized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- Bảng quản lý yêu cầu xóa định danh cá nhân (Right to Erasure / Nghị định 13/2023/NĐ-CP)
CREATE TABLE IF NOT EXISTS farmer_anonymization_requests (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  requester_name VARCHAR(255) NOT NULL,
  requester_phone VARCHAR(32),
  legal_basis VARCHAR(128) NOT NULL DEFAULT 'Nghi dinh 13/2023/ND-CP',
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by VARCHAR(128) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_farms_anonymized ON farms(is_anonymized);
CREATE INDEX IF NOT EXISTS idx_farmer_anon_requests_farm ON farmer_anonymization_requests(farm_id);
