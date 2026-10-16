-- Migration 024: Cold Chain Shipments (Story S-40 / Jira N2-211)
-- Thiết kế chuyến vận chuyển liên kết một thùng lạnh với nhiều lô hàng nông sản.
-- Hỗ trợ chặn một lô tham gia hai chuyến đang hoạt động đồng thời (kể cả request cạnh tranh).

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

-- Ràng buộc cốt lõi chặn một lô tham gia 2 chuyến đang hoạt động đồng thời (S-40 AC4)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_lot 
ON shipment_lots (lot_id) 
WHERE is_active = TRUE;

-- Ràng buộc cốt lõi chặn một thùng lạnh tham gia 2 chuyến đang hoạt động đồng thời (S-40 AC-S40-05 / TC-S40-10)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_cold_box
ON shipments (cold_box_id)
WHERE status = 'IN_TRANSIT';

-- Các index phục vụ tìm kiếm và báo cáo
CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(organization_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_cold_box ON shipments(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipment_lots_shipment ON shipment_lots(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_lots_lot ON shipment_lots(lot_id);
CREATE INDEX IF NOT EXISTS idx_shipment_lots_active ON shipment_lots(is_active);

-- Cấp quyền DML trên shipments và shipment_lots cho tài khoản ứng dụng agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipments TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_lots TO agri_app;
    END IF;
END $$;
