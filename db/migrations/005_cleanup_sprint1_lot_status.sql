-- Migration 005: Cleanup Sprint 1 Lot Status scope
-- Chuan hoa trang thai mac dinh va du lieu lo ve 'Da ghi nhan' (dung scope Sprint 1)
ALTER TABLE lots
ALTER COLUMN status SET DEFAULT 'Đã ghi nhận';

UPDATE lots
SET status = 'Đã ghi nhận'
WHERE status IN ('Đang vận chuyển', 'Đã nhập kho');
