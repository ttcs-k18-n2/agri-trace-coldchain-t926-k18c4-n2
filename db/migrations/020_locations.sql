-- Migration 020: Quản lý địa điểm, kho bãi và cửa hàng phân phối (Story S-30)
CREATE TABLE IF NOT EXISTS locations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_type VARCHAR(50) NOT NULL DEFAULT 'warehouse', -- 'warehouse', 'store', 'cold_storage', 'distribution_center'
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  coordinates JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_org_id ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(location_type);

-- Bổ sung trường location_id cho bảng lots để theo dõi vị trí thực tế của từng lô nông sản (S-27 & S-30)
ALTER TABLE lots ADD COLUMN IF NOT EXISTS location_id VARCHAR(64) REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lots_location_id ON lots(location_id);

-- Dữ liệu mẫu địa điểm ban đầu cho các tổ chức
INSERT INTO locations (id, name, address, organization_id, location_type, contact_person, phone)
VALUES
  ('LOC-WH-TN-01', 'Kho lạnh Nông trại Thái Nguyên', 'Xã La Bằng, Huyện Đại Từ, Thái Nguyên', 'org-001', 'cold_storage', 'Nguyễn Văn Nông', '0912345678'),
  ('LOC-WH-BG-01', 'Kho trung chuyển HTX Bắc Giang', 'Thị trấn Nham Biền, Huyện Yên Dũng, Bắc Giang', 'org-002', 'warehouse', 'Trần Thị Xã', '0923456789'),
  ('LOC-HUB-HN-01', 'Tổng kho lạnh Logistics Hà Nội', 'KCN Đài Tư, Quận Long Biên, Hà Nội', 'org-trans', 'cold_storage', 'Lê Vận Chuyển', '0934567890'),
  ('LOC-STORE-HN-01', 'Trung tâm Phân phối & Bán lẻ Cầu Giấy', '123 Đường Cầu Giấy, Quận Cầu Giấy, Hà Nội', 'org-dist', 'store', 'Phạm Phân Phối', '0945678901'),
  ('LOC-STORE-HN-02', 'Điểm bán lẻ Nông sản Sạch Thanh Xuân', '45 Đường Nguyễn Trãi, Quận Thanh Xuân, Hà Nội', 'org-dist', 'store', 'Hoàng Bán Lẻ', '0956789012')
ON CONFLICT (id) DO NOTHING;

-- Gán vị trí mẫu cho các lô hiện có
UPDATE lots SET location_id = 'LOC-WH-TN-01' WHERE id IN ('LOT-001', 'LOT-002') AND location_id IS NULL;
UPDATE lots SET location_id = 'LOC-WH-BG-01' WHERE id IN ('LOT-101', 'LOT-102') AND location_id IS NULL;
UPDATE lots SET location_id = 'LOC-STORE-HN-01' WHERE id = 'LOT-DIST-01' AND location_id IS NULL;
UPDATE lots SET location_id = 'LOC-STORE-HN-02' WHERE id = 'LOT-DIST-02' AND location_id IS NULL;

-- Cấp quyền cho user agri_app nếu có
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO agri_app;
    END IF;
END $$;
