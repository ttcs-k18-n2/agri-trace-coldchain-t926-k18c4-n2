-- Migration 004: Farms table with organization foreign key, index, and area > 0 constraint
CREATE TABLE IF NOT EXISTS farms (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('farm-' || substr(md5(random()::text), 1, 8)),
    name VARCHAR(255) NOT NULL,
    area NUMERIC(10, 2) NOT NULL CHECK (area > 0),
    coordinates VARCHAR(255),
    organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farms_organization_id ON farms(organization_id);

-- Alter lots table to reference farms optionally
ALTER TABLE lots ADD COLUMN IF NOT EXISTS farm_id VARCHAR(50) REFERENCES farms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lots_farm_id ON lots(farm_id);

-- Seed demo farms for org-001 and org-002
INSERT INTO farms (id, name, area, coordinates, organization_id) VALUES
    ('FARM-001', 'Thửa đồi chè La Bằng 01', 2.50, '21.5645, 105.6789', 'org-001'),
    ('FARM-002', 'Thửa cà chua Hùng Sơn 02', 1.20, '21.5712, 105.6841', 'org-001'),
    ('FARM-101', 'Thửa rau cải Yên Dũng 01', 3.00, '21.2341, 106.1892', 'org-002')
ON CONFLICT (id) DO NOTHING;

-- Link existing demo lots to farms
UPDATE lots SET farm_id = 'FARM-001' WHERE id = 'LOT-002';
UPDATE lots SET farm_id = 'FARM-002' WHERE id = 'LOT-001';
UPDATE lots SET farm_id = 'FARM-101' WHERE id = 'LOT-101';
