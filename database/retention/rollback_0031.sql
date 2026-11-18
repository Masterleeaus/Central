-- Rollback for migrations/0031_retention_exports.sql. Run by a privileged operator, not by the purge job.
-- Removes titan.retention_exports only when it holds no rows. Stored exports are evidence, so the rollback
-- refuses to drop them. Export and archive them first if a rollback is really needed. Run inside one transaction.
BEGIN;

DO $$
BEGIN
  IF to_regclass('titan.retention_exports') IS NOT NULL
     AND EXISTS (SELECT 1 FROM titan.retention_exports) THEN
    RAISE EXCEPTION 'titan.retention_exports holds export rows; rollback refused. Archive them first.';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS retention_exports_reject_row_change ON titan.retention_exports;
DROP TRIGGER IF EXISTS retention_exports_reject_truncate ON titan.retention_exports;
DROP TABLE IF EXISTS titan.retention_exports;
DROP FUNCTION IF EXISTS titan.reject_retention_export_change();

DELETE FROM public.schema_migrations WHERE version = 31;

COMMIT;
