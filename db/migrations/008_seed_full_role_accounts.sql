-- Migration 008: Seed full role organizations and demo accounts for staging
-- Ensures all 7 roles (admin, org_admin, producer, cooperative, transporter, distributor, inspector)
-- have persistent database accounts on staging instead of relying on in-memory fallback.

INSERT INTO organizations (id, name, type) VALUES
    ('org-system', 'Cơ quan Quản lý Chuỗi Lạnh Toàn quốc', 'admin'),
    ('org-trans', 'Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu', 'transporter'),
    ('org-dist', 'Tổng Công ty Phân phối Nông sản & Bán lẻ', 'distributor')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- Insert demo users with Argon2id hash for 'Password@123'
INSERT INTO users (id, email, password_hash, organization_id, role_id, failed_count, locked_until) VALUES
    ('usr-admin', 'admin@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-system', 'admin', 0, NULL),
    ('usr-orgadmin', 'orgadmin@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-001', 'org_admin', 0, NULL),
    ('usr-transporter', 'transporter@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-trans', 'transporter', 0, NULL),
    ('usr-distributor', 'distributor@example.com', '$argon2id$v=19$m=65536,p=4,t=3$HiO9lSULt+J1JKRg8xCQjQ$ZeBnWPLqBZAwSf9/PXqMxMoYS1goLyyzy2ixt7PRbRs', 'org-dist', 'distributor', 0, NULL)
ON CONFLICT (email) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    role_id = EXCLUDED.role_id,
    password_hash = EXCLUDED.password_hash;
