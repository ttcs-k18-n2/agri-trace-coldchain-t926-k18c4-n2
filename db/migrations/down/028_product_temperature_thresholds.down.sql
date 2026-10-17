-- Migration Down 028: Revert Product Temperature Thresholds and Delay Configuration
-- Hoàn tác các cột cấu hình ngưỡng trên bảng products và shipments

ALTER TABLE shipments
DROP COLUMN IF EXISTS temperature_config,
DROP COLUMN IF EXISTS applied_delay_minutes,
DROP COLUMN IF EXISTS applied_temp_max,
DROP COLUMN IF EXISTS applied_temp_min;

ALTER TABLE products
DROP CONSTRAINT IF EXISTS chk_products_delay_non_negative,
DROP CONSTRAINT IF EXISTS chk_products_temp_range,
DROP CONSTRAINT IF EXISTS chk_products_temp_bounds;

ALTER TABLE products
DROP COLUMN IF EXISTS delay_minutes,
DROP COLUMN IF EXISTS temp_max,
DROP COLUMN IF EXISTS temp_min;
