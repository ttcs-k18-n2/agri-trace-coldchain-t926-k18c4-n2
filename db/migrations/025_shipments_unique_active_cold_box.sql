-- Migration 025: Enforce unique active shipment per cold box safely (S-40 / Jira N2-211)
-- Additive idempotent migration to create idx_unique_active_shipment_per_cold_box for existing databases
-- where migration 024 was already applied, without dropping shipment tables or destroying data.

DO $$
DECLARE
    dup_summary TEXT;
BEGIN
    -- 1. Idempotency & index duplication check: If index already exists, skip creation safely
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
          AND tablename = 'shipments' 
          AND indexname = 'idx_unique_active_shipment_per_cold_box'
    ) THEN
        -- 2. Pre-existing duplicate check: detect if duplicate active shipments exist for any cold box
        SELECT string_agg(
            format('cold_box_id=%s (count=%s, shipments=[%s])', cold_box_id, cnt, shipment_ids),
            '; '
        )
        INTO dup_summary
        FROM (
            SELECT cold_box_id, count(*) AS cnt, string_agg(id, ', ' ORDER BY id) AS shipment_ids
            FROM shipments
            WHERE status = 'IN_TRANSIT'
            GROUP BY cold_box_id
            HAVING count(*) > 1
        ) dups;

        IF dup_summary IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot apply migration 025: pre-existing duplicate active shipments found: %. Action required: Resolve or transition duplicate IN_TRANSIT shipments to COMPLETED or CANCELLED before applying this migration. Do NOT delete business data manually without audit.', dup_summary;
        END IF;

        -- 3. Safely create unique partial index
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_cold_box ON shipments (cold_box_id) WHERE status = ''IN_TRANSIT''';
    ELSE
        RAISE NOTICE 'Index idx_unique_active_shipment_per_cold_box already exists, skipping creation.';
    END IF;
END $$;
