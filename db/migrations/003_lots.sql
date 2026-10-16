CREATE TABLE IF NOT EXISTS lots (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Đang vận chuyển',
    organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lots_organization_id ON lots(organization_id);

INSERT INTO lots (id, name, status, organization_id) VALUES
    ('LOT-001', 'Lô cà chua Thái Nguyên', 'Đang vận chuyển', 'org-001'),
    ('LOT-002', 'Lô chè Tân Cương', 'Đã nhập kho', 'org-001'),
    ('LOT-101', 'Lô rau cải Bắc Giang', 'Đã thu hoạch', 'org-002'),
    ('LOT-102', 'Lô dưa chuột Hiệp Hòa', 'Đang vận chuyển', 'org-002')
ON CONFLICT (id) DO NOTHING;
