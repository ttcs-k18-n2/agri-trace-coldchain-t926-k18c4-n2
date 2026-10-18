-- Migration 029: Public Lot Cache and Anti-Enumeration Rate Limiting (Story S-50 / Jira N2-119 / N2-282)
-- 1. Lưu trữ bản cache 60s cho kết quả truy xuất công khai
-- 2. Giới hạn tần suất: chặn tạm địa chỉ IP truy vấn hơn 30 mã lô khác nhau trong 60s
-- 3. Lưu danh sách IP đang bị chặn tạm thời

CREATE TABLE IF NOT EXISTS public_lot_cache (
    lot_code VARCHAR(100) PRIMARY KEY,
    payload JSONB NOT NULL,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_lot_cache_expires_at ON public_lot_cache (expires_at);

CREATE TABLE IF NOT EXISTS public_lot_rate_limits (
    id BIGSERIAL PRIMARY KEY,
    client_ip VARCHAR(50) NOT NULL,
    lot_code VARCHAR(100) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_rate_limit_ip_window ON public_lot_rate_limits (client_ip, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_rate_limit_ip_code ON public_lot_rate_limits (client_ip, lot_code);
CREATE INDEX IF NOT EXISTS idx_public_rate_limit_expires_at ON public_lot_rate_limits (expires_at);

CREATE TABLE IF NOT EXISTS public_blocked_ips (
    client_ip VARCHAR(50) PRIMARY KEY,
    blocked_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_blocked_ips_until ON public_blocked_ips (blocked_until);

-- Cấp quyền DML cho agri_app nếu tồn tại
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON public_lot_cache TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON public_lot_rate_limits TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON public_blocked_ips TO agri_app;
        GRANT USAGE, SELECT ON SEQUENCE public_lot_rate_limits_id_seq TO agri_app;
    END IF;
END $$;
