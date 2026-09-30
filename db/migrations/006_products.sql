-- Migration 006: Products table with ENUM unit and lower-case unique index
DO $$ BEGIN
    CREATE TYPE product_unit AS ENUM ('kg', 'tan', 'thung');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    unit product_unit NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In case products already existed with varchar column, alter it to enum type
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'unit' AND data_type = 'character varying'
    ) THEN
        ALTER TABLE products ALTER COLUMN unit TYPE product_unit USING unit::product_unit;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_lower
ON products (LOWER(name));

-- Seed initial products (idempotent)
INSERT INTO products (id, name, unit) VALUES
    ('PROD-TOMATO', 'Cà chua', 'kg'),
    ('PROD-TEA', 'Chè', 'kg'),
    ('PROD-VEGETABLE', 'Rau cải', 'kg')
ON CONFLICT (id) DO NOTHING;
