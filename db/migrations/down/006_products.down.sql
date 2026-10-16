-- Down Migration 006: Rollback products table
DROP TABLE IF EXISTS products CASCADE;
DROP TYPE IF EXISTS product_unit CASCADE;
