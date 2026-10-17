-- Rollback Migration 026: Shipment Temperatures (Story S-41 / Jira N2-109)
-- Thu hồi an toàn các đối tượng nhiệt độ mới tạo, không làm tổn hại cấu trúc bảng shipments trước đó.

DROP TABLE IF EXISTS shipment_temperatures CASCADE;
ALTER TABLE shipments DROP COLUMN IF EXISTS current_temperature;
ALTER TABLE shipments DROP COLUMN IF EXISTS last_temperature_at;
