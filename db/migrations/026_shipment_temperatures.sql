-- Migration 026: Shipment Temperatures for Cold Chain (Story S-41 / Jira N2-109)
-- Ghi nhận số đo nhiệt độ theo thời gian cho chuyến vận chuyển thùng lạnh.
-- Đảm bảo toàn vẹn: duy nhất (shipment_id, recorded_at), khóa dòng và cập nhật có điều kiện chống ghi đè số đo mới bởi số đo cũ đến trễ.

CREATE TABLE IF NOT EXISTS shipment_temperatures (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('temp-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    temperature NUMERIC(5, 2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipment_temperature_timestamp UNIQUE (shipment_id, recorded_at)
);

-- Mở rộng bảng shipments để lưu số đo hiện hành mới nhất phục vụ truy vấn nhanh và khóa điều kiện
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS current_temperature NUMERIC(5, 2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_temperature_at TIMESTAMPTZ;

-- Các chỉ mục phục vụ truy vấn theo chuyến, thùng lạnh và thời điểm đo
CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_shipment ON shipment_temperatures(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_cold_box ON shipment_temperatures(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_recorded_at ON shipment_temperatures(recorded_at DESC);

-- Cấp quyền DML trên shipment_temperatures cho vai trò ứng dụng agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_temperatures TO agri_app;
    END IF;
END $$;
