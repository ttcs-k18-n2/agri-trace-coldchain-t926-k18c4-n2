-- Migration 002: Organizations, Roles, Users
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 7 roles (idempotent)
INSERT INTO roles (id, name, description) VALUES
    ('admin', 'Quản trị hệ thống', 'Quản trị toàn bộ hệ thống'),
    ('org_admin', 'Quản trị tổ chức', 'Quản trị viên của một tổ chức'),
    ('producer', 'Vùng trồng', 'Cơ sở sản xuất, nông trại canh tác nông sản'),
    ('cooperative', 'Hợp tác xã', 'Hợp tác xã thu gom, sơ chế và đóng gói'),
    ('transporter', 'Vận chuyển', 'Đơn vị logistics và giám sát chuỗi lạnh'),
    ('distributor', 'Phân phối', 'Nhà phân phối, siêu thị và bán lẻ'),
    ('inspector', 'Cán bộ kiểm tra', 'Cán bộ thanh tra an toàn thực phẩm và chuỗi cung ứng')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('usr-' || substr(md5(random()::text), 1, 8)),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    organization_id VARCHAR(50) REFERENCES organizations(id) ON DELETE SET NULL,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id),
    failed_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Seed initial organizations (idempotent)
INSERT INTO organizations (id, name, type) VALUES
    ('org-001', 'Nông trại Thái Nguyên', 'producer'),
    ('org-002', 'Hợp tác xã Rau Sạch Bắc Giang', 'cooperative'),
    ('org-inspector', 'Cục Kiểm tra An toàn Nông sản', 'inspector')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- Seed initial demo users with Argon2id hash for 'Password@123'
INSERT INTO users (id, email, password_hash, organization_id, role_id, failed_count, locked_until) VALUES
    ('usr-001', 'user@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-001', 'producer', 0, NULL),
    ('usr-002', 'user2@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-002', 'cooperative', 0, NULL),
    ('usr-inspector', 'inspector@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-inspector', 'inspector', 0, NULL)
ON CONFLICT (email) DO NOTHING;
