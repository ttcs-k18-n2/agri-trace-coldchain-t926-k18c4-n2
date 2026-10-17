-- Rollback Migration 024: Xóa cột custom_coordinates khỏi bảng lots
ALTER TABLE lots DROP COLUMN IF EXISTS custom_coordinates;
