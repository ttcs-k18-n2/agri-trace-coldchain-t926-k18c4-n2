-- Migration 025: Cold Chain Threshold Monitoring & Violation Detection (Story S-43 / Jira N2-111)
-- Giám sát chuỗi lạnh: Phát hiện vi phạm ngưỡng có độ trễ 30 phút, không gộp hai lần vượt cách xa nhau.

-- 1. Bảng chuyến vận chuyển (hỗ trợ tạo nếu chưa có từ S-40)
CREATE TABLE IF NOT EXISTS shipments (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('shp-' || substr(md5(random()::text), 1, 8)),
    cold_box_id VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
    organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
    created_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    completed_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    vehicle_plate VARCHAR(50),
    driver_name VARCHAR(100),
    driver_phone VARCHAR(20),
    origin_location_id VARCHAR(50),
    destination_location_id VARCHAR(50),
    notes TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Bảng liên kết lô và chuyến
CREATE TABLE IF NOT EXISTS shipment_lots (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('shplot-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    lot_id VARCHAR(50) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(30) NOT NULL DEFAULT 'LOADED' CHECK (status IN ('LOADED', 'DELIVERED', 'REMOVED')),
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unloaded_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipment_lot_pair UNIQUE (shipment_id, lot_id)
);

-- 3. Bảng số đo nhiệt độ chuỗi lạnh theo thời gian (Telemetry)
CREATE TABLE IF NOT EXISTS temperature_readings (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('temp-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    temperature NUMERIC(5, 2) NOT NULL,
    humidity NUMERIC(5, 2),
    recorded_at TIMESTAMPTZ NOT NULL,
    organization_id VARCHAR(50) REFERENCES organizations(id),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Bảng vi phạm ngưỡng nhiệt độ chuỗi lạnh (S-43 Violations)
CREATE TABLE IF NOT EXISTS temperature_violations (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('viol-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    organization_id VARCHAR(50) REFERENCES organizations(id),
    threshold_value NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    peak_temperature NUMERIC(5, 2) NOT NULL,
    duration_minutes NUMERIC(8, 2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'RESOLVED' CHECK (status IN ('DETECTED', 'ONGOING', 'RESOLVED', 'ACKNOWLEDGED')),
    excursions_count INT NOT NULL DEFAULT 1,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chỉ mục tối ưu hiệu năng truy vấn và báo cáo
CREATE INDEX IF NOT EXISTS idx_temp_readings_shipment ON temperature_readings(shipment_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_temp_readings_coldbox ON temperature_readings(cold_box_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_temp_readings_org ON temperature_readings(organization_id);

CREATE INDEX IF NOT EXISTS idx_temp_violations_shipment ON temperature_violations(shipment_id, start_time);
CREATE INDEX IF NOT EXISTS idx_temp_violations_coldbox ON temperature_violations(cold_box_id, start_time);
CREATE INDEX IF NOT EXISTS idx_temp_violations_org ON temperature_violations(organization_id);
CREATE INDEX IF NOT EXISTS idx_temp_violations_status ON temperature_violations(status);

-- Cấp quyền DML trên các bảng mới cho tài khoản ứng dụng agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipments TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_lots TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON temperature_readings TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON temperature_violations TO agri_app;
    END IF;
END $$;
