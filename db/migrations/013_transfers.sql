-- Migration 013: Lot Transfers Table (S-15: Bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận)
-- Hỗ trợ quy trình bàn giao lô hàng giữa các tổ chức với trạng thái chờ xác nhận (PENDING).

CREATE TABLE IF NOT EXISTS lot_transfers (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('trf-' || substr(md5(random()::text), 1, 8)),
    lot_id VARCHAR(50) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    from_organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
    to_organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
    notes TEXT,
    created_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    resolved_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_different_orgs CHECK (from_organization_id <> to_organization_id)
);

-- Chỉ cho phép tối đa 1 yêu cầu bàn giao ở trạng thái PENDING cho mỗi lô hàng tại cùng một thời điểm (S-15)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_transfer_per_lot 
ON lot_transfers (lot_id) 
WHERE status = 'PENDING';

-- Các index hỗ trợ truy vấn hiệu năng cao
CREATE INDEX IF NOT EXISTS idx_lot_transfers_lot_id ON lot_transfers(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_from_org ON lot_transfers(from_organization_id);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_to_org ON lot_transfers(to_organization_id);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_status ON lot_transfers(status);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_created_at ON lot_transfers(created_at DESC);
