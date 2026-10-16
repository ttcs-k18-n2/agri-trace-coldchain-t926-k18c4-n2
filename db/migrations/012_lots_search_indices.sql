-- Migration 012: Indices for organization lots cursor pagination and product filter (S-14 / T-33)
CREATE INDEX IF NOT EXISTS idx_lots_org_harvest_created_id
ON lots(organization_id, harvested_at DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lots_org_product_harvest
ON lots(organization_id, product_id, harvested_at DESC);
