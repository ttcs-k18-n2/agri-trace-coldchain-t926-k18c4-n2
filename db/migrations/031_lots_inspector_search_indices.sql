-- Migration 031: Tối ưu hóa chỉ mục tìm kiếm lô hàng cho Cán bộ kiểm tra (Story S-52 / Epic E-09)
-- Cho phép tra cứu nhanh theo vùng trồng kết hợp ngày thu hoạch trên toàn quốc
CREATE INDEX IF NOT EXISTS idx_lots_farm_harvested
ON lots(farm_id, harvested_at DESC);

CREATE INDEX IF NOT EXISTS idx_lots_harvested_at
ON lots(harvested_at DESC);
