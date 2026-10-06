-- Migration 015: Composite index on batch_events (batch_id, occurred_at) for fast timeline querying (T-23 / S-10)
-- Bổ sung chỉ mục kết hợp phục vụ truy vấn chuỗi thời gian sự kiện theo lô hàng tối ưu hiệu năng
CREATE INDEX IF NOT EXISTS idx_batch_events_batch_occurred
ON batch_events(batch_id, occurred_at);
