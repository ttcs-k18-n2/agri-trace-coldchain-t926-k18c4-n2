-- Migration 021: Nhật ký thao tác nghiệp vụ riêng biệt (Story S-31)
-- Phục vụ kiểm toán hành vi người dùng, độc lập hoàn toàn với sổ cái băm sự kiện lô (batch_events) và log bảo mật.
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id VARCHAR(64),
  actor_email VARCHAR(255),
  organization_id VARCHAR(64) NOT NULL,
  action VARCHAR(100) NOT NULL, -- e.g. 'LOT_CREATED', 'LOT_SPLIT', 'LOT_MERGED', 'TRANSFER_INITIATED', 'LOCATION_CREATED', etc.
  resource_type VARCHAR(64) NOT NULL, -- 'lot', 'transfer', 'location', 'csv', 'product'
  resource_id VARCHAR(64),
  ip_address VARCHAR(45),
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Cấp quyền cho user agri_app nếu có
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT ON audit_logs TO agri_app;
    END IF;
END $$;
