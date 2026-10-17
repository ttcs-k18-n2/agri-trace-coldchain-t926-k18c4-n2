-- Migration 023: Bảng lệnh thu hồi nông sản (Recall Orders) (Story S-33 & S-34)
-- Tuân thủ NFR: Không lưu snapshot cứng danh sách hậu duệ để bảo đảm tính toán động thời gian thực

CREATE TABLE IF NOT EXISTS recall_orders (
    id VARCHAR(64) PRIMARY KEY,
    lot_id VARCHAR(64) NOT NULL REFERENCES lots(id),
    reason TEXT NOT NULL,
    severity VARCHAR(32) DEFAULT 'HIGH' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(32) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'COMPLETED', 'CANCELLED')),
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recall_orders_lot_id ON recall_orders(lot_id);
CREATE INDEX IF NOT EXISTS idx_recall_orders_status ON recall_orders(status);
CREATE INDEX IF NOT EXISTS idx_recall_orders_created_at ON recall_orders(created_at DESC);
