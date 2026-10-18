-- Migration 032: Quét toàn vẹn chuỗi hash định kỳ hằng đêm và ghi nhận cảnh báo (Story S-55 / Epic E-10)
CREATE TABLE IF NOT EXISTS integrity_audit_jobs (
  id VARCHAR(64) PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_lots_scanned INT NOT NULL DEFAULT 0,
  compromised_lots_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrity_audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  job_id VARCHAR(64) REFERENCES integrity_audit_jobs(id) ON DELETE CASCADE,
  lot_id VARCHAR(64) NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  error_type VARCHAR(64),
  error_message TEXT,
  first_invalid_sequence INT,
  final_hash VARCHAR(64),
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_audit_jobs_started ON integrity_audit_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_integrity_audit_logs_lot ON integrity_audit_logs(lot_id);
CREATE INDEX IF NOT EXISTS idx_integrity_audit_logs_compromised ON integrity_audit_logs(is_valid) WHERE is_valid = FALSE;
