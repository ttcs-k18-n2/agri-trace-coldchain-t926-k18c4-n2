-- Migration 017: Create batch_relations table (T-39: Quan hệ phân tách và sáp nhập lô hàng)
-- Hỗ trợ truy vết phả hệ đa chiều giữa các lô nguồn (parent_batch_id) và lô đích (child_batch_id)
CREATE TABLE IF NOT EXISTS batch_relations (
    id VARCHAR(64) PRIMARY KEY DEFAULT ('rel-' || substr(md5(random()::text), 1, 12)),
    parent_batch_id VARCHAR(64) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    child_batch_id VARCHAR(64) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    relation_type VARCHAR(32) NOT NULL DEFAULT 'SPLIT' CHECK (relation_type IN ('SPLIT', 'MERGE')),
    quantity NUMERIC(15, 3) NOT NULL CHECK (quantity > 0),
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_diff_batch CHECK (parent_batch_id <> child_batch_id),
    CONSTRAINT uq_batch_relations_parent_child UNIQUE (parent_batch_id, child_batch_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_relations_parent ON batch_relations(parent_batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_relations_child ON batch_relations(child_batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_relations_org ON batch_relations(organization_id);
CREATE INDEX IF NOT EXISTS idx_batch_relations_type ON batch_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_batch_relations_created_at ON batch_relations(created_at DESC);

-- Cấp quyền DML trên batch_relations cho tài khoản ứng dụng agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON batch_relations TO agri_app;
    END IF;
END $$;
