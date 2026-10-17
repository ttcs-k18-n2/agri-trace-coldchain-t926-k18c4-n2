-- Migration 024: Recall Acknowledgments (Story S-36 / S-37)

CREATE TABLE IF NOT EXISTS recall_acknowledgments (
    id SERIAL PRIMARY KEY,
    recall_id VARCHAR(64) NOT NULL REFERENCES recall_orders(id) ON DELETE CASCADE,
    organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
    org_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'ACKNOWLEDGED',
    note TEXT,
    created_by_user_id VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recall_acknowledgments_recall_org UNIQUE (recall_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_recall_acknowledgments_recall_id ON recall_acknowledgments(recall_id);
CREATE INDEX IF NOT EXISTS idx_recall_acknowledgments_org_id ON recall_acknowledgments(organization_id);
