-- Migration 006: Products table with check constraint on unit and lower-case unique index
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (unit IN ('kg', 'tan', 'thung'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_lower
ON products (LOWER(name));

-- Seed initial products (idempotent)
INSERT INTO products (id, name, unit) VALUES
    ('PROD-TOMATO', 'Cà chua', 'kg'),
    ('PROD-TEA', 'Chè', 'kg'),
    ('PROD-VEGETABLE', 'Rau cải', 'kg')
ON CONFLICT (id) DO NOTHING;
