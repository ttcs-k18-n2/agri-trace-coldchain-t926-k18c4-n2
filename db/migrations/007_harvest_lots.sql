-- Migration 007: Expand lots table for harvest batches
ALTER TABLE lots
ADD COLUMN IF NOT EXISTS product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS initial_quantity NUMERIC(14,3),
ADD COLUMN IF NOT EXISTS remaining_quantity NUMERIC(14,3),
ADD COLUMN IF NOT EXISTS harvested_at DATE;

-- Update existing seed lots with initial demo quantities and product references
UPDATE lots SET product_id = 'PROD-TOMATO', initial_quantity = 500.000, remaining_quantity = 500.000, harvested_at = '2026-09-25' WHERE id = 'LOT-001' AND initial_quantity IS NULL;
UPDATE lots SET product_id = 'PROD-TEA', initial_quantity = 120.000, remaining_quantity = 120.000, harvested_at = '2026-09-26' WHERE id = 'LOT-002' AND initial_quantity IS NULL;
UPDATE lots SET product_id = 'PROD-VEGETABLE', initial_quantity = 300.000, remaining_quantity = 300.000, harvested_at = '2026-09-27' WHERE id = 'LOT-101' AND initial_quantity IS NULL;
UPDATE lots SET initial_quantity = 250.000, remaining_quantity = 250.000, harvested_at = '2026-09-28' WHERE id = 'LOT-102' AND initial_quantity IS NULL;

-- Add check constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_lots_initial_quantity'
    ) THEN
        ALTER TABLE lots ADD CONSTRAINT chk_lots_initial_quantity CHECK (initial_quantity IS NULL OR initial_quantity > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_lots_remaining_quantity'
    ) THEN
        ALTER TABLE lots ADD CONSTRAINT chk_lots_remaining_quantity CHECK (
            remaining_quantity IS NULL OR (
                remaining_quantity >= 0 AND (initial_quantity IS NULL OR remaining_quantity <= initial_quantity)
            )
        );
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lots_product_id ON lots(product_id);
CREATE INDEX IF NOT EXISTS idx_lots_farm_id ON lots(farm_id);
CREATE INDEX IF NOT EXISTS idx_lots_created_at ON lots(created_at DESC);
