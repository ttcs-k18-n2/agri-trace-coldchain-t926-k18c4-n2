-- Migration 018: Add index on lots status for recall and consumption tracking (S-29)
-- Hỗ trợ phân biệt nhanh lô còn trên kệ và lô đã tiêu thụ trong danh sách thu hồi.
CREATE INDEX IF NOT EXISTS idx_lots_status ON lots(status);
CREATE INDEX IF NOT EXISTS idx_lots_org_status ON lots(organization_id, status);
