-- Migration 010: Role segregation & append-only permissions for batch_events (S-11)
-- Tách tài khoản:
--   agri_migration: DDL / schema migrations
--   agri_app: DML ứng dụng chạy thật, batch_events CHỈ ĐƯỢC SELECT và INSERT

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles
    WHERE rolname = 'agri_app'
  ) THEN
    CREATE ROLE agri_app WITH LOGIN PASSWORD 'app_password';
  END IF;
END
$$;

-- Cấp quyền kết nối database hiện tại cho agri_app
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO agri_app', current_database());
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

GRANT USAGE ON SCHEMA public TO agri_app;

-- Cấp toàn quyền thao tác dữ liệu trên schema public cho agri_app
GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public
TO agri_app;

-- Cấp quyền sử dụng sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agri_app;

-- KHÓA CHẶT BẢNG batch_events: BẢNG SỰ KIỆN CHỈ-THÊM (APPEND-ONLY)
-- Ứng dụng chỉ được SELECT và INSERT
GRANT SELECT, INSERT
ON batch_events
TO agri_app;

-- Tuyệt đối cấm UPDATE, DELETE, TRUNCATE từ tài khoản ứng dụng
REVOKE UPDATE, DELETE, TRUNCATE
ON batch_events
FROM agri_app;
