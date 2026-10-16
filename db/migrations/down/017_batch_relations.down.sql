-- Rollback Migration 017: Drop batch_relations table (T-39)
DROP TABLE IF EXISTS batch_relations CASCADE;
