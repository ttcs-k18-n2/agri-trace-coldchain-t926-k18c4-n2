-- Migration 023 Rollback: Xóa bảng recall_orders (Story S-33 & S-34)

DROP TABLE IF EXISTS recall_orders CASCADE;
