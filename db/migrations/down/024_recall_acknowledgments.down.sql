-- Migration 024 Rollback: Drop recall_acknowledgments (Story S-36 / S-37)
DROP TABLE IF EXISTS recall_acknowledgments CASCADE;
