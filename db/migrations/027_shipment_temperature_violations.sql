-- Migration 027: Shipment Temperature Violations and Streaming Detector State (Story S-43)
-- Lưu trữ các bản ghi vi phạm ngưỡng nhiệt độ (Cold Chain Excursions) và trạng thái streaming detector.
-- Tái sử dụng bảng shipments và shipment_temperatures, không tạo cấu trúc song song.

CREATE TABLE IF NOT EXISTS temperature_violations (
    id VARCHAR(50) PRIMARY KEY,
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    organization_id VARCHAR(50),
    threshold_value NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    peak_temperature NUMERIC(5, 2) NOT NULL,
    duration_minutes NUMERIC(8, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ONGOING',
    excursions_count INT NOT NULL DEFAULT 1,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mở rộng bảng shipments để lưu trạng thái detector giới hạn kích thước (bounded detector state)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS detector_state JSONB;

-- Chỉ mục hỗ trợ truy vấn vi phạm theo chuyến, thùng lạnh, tổ chức, trạng thái và thời gian bắt đầu
CREATE INDEX IF NOT EXISTS idx_temp_violations_shipment ON temperature_violations(shipment_id);
CREATE INDEX IF NOT EXISTS idx_temp_violations_cold_box ON temperature_violations(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_temp_violations_org ON temperature_violations(organization_id);
CREATE INDEX IF NOT EXISTS idx_temp_violations_start ON temperature_violations(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_temp_violations_status ON temperature_violations(status);

-- Phân quyền DML cho agri_app nếu tồn tại
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON temperature_violations TO agri_app;
    END IF;
END $$;
