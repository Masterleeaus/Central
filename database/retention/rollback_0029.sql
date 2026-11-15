-- Rollback for migrations/0029_retention_purge_superuser_guard.sql. Run by a privileged operator, not by the purge job.
-- Restores the migration 0028 trigger function exactly (superuser DELETE carve-out included). Run inside one transaction.
BEGIN;

CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff_text text;
BEGIN
  IF TG_OP = 'DELETE' AND pg_has_role(current_user, 'titan_retention_purger', 'MEMBER') THEN
    cutoff_text := current_setting('titan.retention_cutoff', true);
    IF cutoff_text IS NOT NULL AND cutoff_text <> '' AND OLD.occurred_at < cutoff_text::timestamptz THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
END
$$;

COMMENT ON FUNCTION titan.reject_activity_event_change() IS
  'Append-only guard for titan.activity_events (0011). Migration 0028 allows purger DELETE of rows older than titan.retention_cutoff.';

DELETE FROM public.schema_migrations WHERE version = 29;

COMMIT;
