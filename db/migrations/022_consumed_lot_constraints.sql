-- Migration 022: Ràng buộc tính nhất quán khối lượng cho lô đã bán hết/tiêu thụ (Story S-29)
-- Đảm bảo lô hàng có trạng thái 'Đã bán hết' hoặc 'Đã tiêu thụ' thì remaining_quantity bắt buộc phải bằng 0.

-- 1. Chuẩn hóa bất kỳ dữ liệu cũ không hợp lệ trước khi áp dụng ràng buộc (idempotent / data healing)
UPDATE lots
SET remaining_quantity = 0
WHERE status IN ('Đã bán hết', 'Đã tiêu thụ')
  AND COALESCE(remaining_quantity, -1) <> 0;

-- 2. Bổ sung ràng buộc CHECK chk_consumed_remaining_zero
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumed_remaining_zero'
    ) THEN
        ALTER TABLE lots
        ADD CONSTRAINT chk_consumed_remaining_zero
        CHECK (
            status NOT IN ('Đã bán hết', 'Đã tiêu thụ')
            OR COALESCE(remaining_quantity, -1) = 0
        );
    END IF;
END $$;
