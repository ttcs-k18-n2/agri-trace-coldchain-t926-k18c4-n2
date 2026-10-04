-- Rollback Migration 010: batch_events_append_only
REVOKE ALL PRIVILEGES ON batch_events FROM agri_app;
REVOKE ALL PRIVILEGES ON products, farms, lots, users, roles, schema_migrations FROM agri_app;
REVOKE USAGE ON SCHEMA public FROM agri_app;
