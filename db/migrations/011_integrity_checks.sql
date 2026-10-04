-- Migration 011: Audit log for lot integrity checks (S-12 / T-29)
CREATE TABLE IF NOT EXISTS integrity_checks (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  checked_by VARCHAR(64),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid BOOLEAN NOT NULL,
  first_invalid_sequence INTEGER,
  error_type VARCHAR(50),
  final_hash VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_integrity_checks_batch_id ON integrity_checks(batch_id);
CREATE INDEX IF NOT EXISTS idx_integrity_checks_checked_at ON integrity_checks(checked_at DESC);

-- Cấp quyền ghi nhận lịch sử kiểm tra toàn vẹn cho tài khoản agri_app
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app'
  ) THEN
    GRANT SELECT, INSERT ON integrity_checks TO agri_app;
  END IF;
END
$$;
