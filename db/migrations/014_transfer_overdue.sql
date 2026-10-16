-- Migration 014: Add overdue tracking to lot_transfers (S-24: Bàn giao quá hạn chưa xác nhận bị đánh dấu cho cả hai bên)
-- Hỗ trợ theo dõi các yêu cầu bàn giao PENDING vượt quá ngưỡng thời gian quy định (mặc định 48h) mà không tự động hủy.

ALTER TABLE lot_transfers 
ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ;

-- Index tối ưu cho job quét rà soát bàn giao quá hạn định kỳ (T-56)
CREATE INDEX IF NOT EXISTS idx_lot_transfers_overdue_scan 
ON lot_transfers (status, is_overdue, created_at) 
WHERE status = 'PENDING';
