-- Migration 028: Product Temperature Thresholds and Delay Configuration (Story S-44 / Jira N2-112)
-- Bổ sung cấu hình ngưỡng nhiệt độ trên, ngưỡng dưới và độ trễ theo sản phẩm.
-- Bổ sung các cột lưu snapshot cấu hình dải nhiệt độ áp dụng cho chuyến vận chuyển.

-- 1. Bổ sung các cột cấu hình ngưỡng vào bảng products
ALTER TABLE products
ADD COLUMN IF NOT EXISTS temp_min NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS temp_max NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS delay_minutes INTEGER;

-- 2. Thêm ràng buộc kiểm tra hợp lệ trên bảng products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_temp_bounds'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT chk_products_temp_bounds CHECK (
            (temp_min IS NULL OR (temp_min >= -999.99 AND temp_min <= 999.99)) AND
            (temp_max IS NULL OR (temp_max >= -999.99 AND temp_max <= 999.99))
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_temp_range'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT chk_products_temp_range CHECK (
            temp_min IS NULL OR temp_max IS NULL OR temp_min < temp_max
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_delay_non_negative'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT chk_products_delay_non_negative CHECK (
            delay_minutes IS NULL OR delay_minutes >= 0
        );
    END IF;
END $$;

-- 3. Cập nhật cấu hình ban đầu mẫu cho các sản phẩm nông sản hiện có (nếu chưa có)
-- Lưu ý: Việc áp đặt mặc định phổ quát được báo BLOCKED chờ GD-8; các sản phẩm cụ thể dưới đây
-- được cấu hình theo đặc thù sinh học của từng loại nông sản:
--   - Cà chua (PROD-TOMATO): bảo quản mát 2.0°C đến 8.0°C, độ trễ 30 phút
--   - Chè (PROD-TEA): bảo quản 5.0°C đến 12.0°C, độ trễ 45 phút
--   - Rau cải (PROD-VEGETABLE): bảo quản 1.0°C đến 6.0°C, độ trễ 20 phút
UPDATE products SET temp_min = 2.00, temp_max = 8.00, delay_minutes = 30 WHERE id = 'PROD-TOMATO' AND temp_min IS NULL;
UPDATE products SET temp_min = 5.00, temp_max = 12.00, delay_minutes = 45 WHERE id = 'PROD-TEA' AND temp_min IS NULL;
UPDATE products SET temp_min = 1.00, temp_max = 6.00, delay_minutes = 20 WHERE id = 'PROD-VEGETABLE' AND temp_min IS NULL;

-- 4. Bổ sung các cột lưu snapshot cấu hình nhiệt độ áp dụng trên bảng shipments
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS applied_temp_min NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS applied_temp_max NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS applied_delay_minutes INTEGER,
ADD COLUMN IF NOT EXISTS temperature_config JSONB;

-- 5. Cấp quyền truy cập DML cho agri_app nếu tồn tại role
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, UPDATE ON products TO agri_app;
        GRANT SELECT, UPDATE ON shipments TO agri_app;
    END IF;
END $$;
