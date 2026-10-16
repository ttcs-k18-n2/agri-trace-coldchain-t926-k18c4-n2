-- Migration 024: Bổ sung cột custom_coordinates vào bảng lots (Story S-60)
-- Lưu trữ tọa độ tùy chỉnh / ghim điểm phân phối hoặc vùng trồng thủ công
ALTER TABLE lots
ADD COLUMN IF NOT EXISTS custom_coordinates JSONB;

-- Đảm bảo quyền cập nhật cho tài khoản ứng dụng agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, UPDATE ON lots TO agri_app;
    END IF;
END $$;
