-- Migration 010: Role segregation & append-only permissions for batch_events (S-11)
-- Tách tài khoản:
--   agri_migration: DDL / schema migrations
--   agri_app: DML ứng dụng chạy thật, batch_events CHỈ ĐƯỢC SELECT và INSERT
--
-- Password của agri_app được lấy từ session setting 'app.db_password' (nếu có)
-- hoặc fallback về 'app_password' cho môi trường phát triển cục bộ.

DO $$
DECLARE
  configured_pwd text := current_setting('app.db_password', true);
BEGIN
  IF configured_pwd IS NULL OR configured_pwd = '' THEN
    configured_pwd := 'app_password';
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles
    WHERE rolname = 'agri_app'
  ) THEN
    EXECUTE format('CREATE ROLE agri_app WITH LOGIN PASSWORD %L', configured_pwd);
  ELSE
    IF current_setting('app.db_password', true) IS NOT NULL AND current_setting('app.db_password', true) <> '' THEN
      EXECUTE format('ALTER ROLE agri_app WITH PASSWORD %L', configured_pwd);
    END IF;
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
