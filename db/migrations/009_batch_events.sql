-- Migration 009: Batch audit events with cryptographic hash chain (S-10 / RFC 8785 SHA-256)
-- Mỗi thay đổi trên lô hàng (bắt đầu bằng HARVEST_CREATED) được ghi thành một bản ghi bất biến có hash chain.
CREATE TABLE IF NOT EXISTS batch_events (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_hash VARCHAR(64) NOT NULL,
  event_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_batch_events_batch_id ON batch_events(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_events_org_id ON batch_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_batch_events_event_type ON batch_events(event_type);
CREATE INDEX IF NOT EXISTS idx_batch_events_created_at ON batch_events(created_at DESC);
