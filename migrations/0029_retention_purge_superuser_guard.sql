-- Migration 0029: close the superuser path through the 0028 retention carve-out.
-- Applied after 0028. Migrations 0001 to 0028 are not edited.
--
-- Problem: pg_has_role(current_user, 'titan_retention_purger', 'MEMBER') is true for a superuser without any
-- membership row, because a superuser has the privileges of every role. The 0028 carve-out therefore let a
-- superuser DELETE rows older than titan.retention_cutoff. The owner is expected to be rejected for every
-- DELETE, UPDATE and TRUNCATE (see tests/sql/activity_events_purge.sql).
--
-- Fix: the DELETE carve-out also requires that current_user is not a superuser. Everything else in the
-- 0028 function stays the same. The purge role itself is NOSUPERUSER, so it keeps the carve-out.
-- Rollback: database/retention/rollback_0029.sql (restores the 0028 function text).
BEGIN;

CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff_text text;
  caller_is_superuser boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_has_role(current_user, 'titan_retention_purger', 'MEMBER') THEN
    SELECT rolsuper INTO caller_is_superuser FROM pg_roles WHERE rolname = current_user;
    IF NOT COALESCE(caller_is_superuser, false) THEN
      cutoff_text := current_setting('titan.retention_cutoff', true);
      IF cutoff_text IS NOT NULL AND cutoff_text <> '' AND OLD.occurred_at < cutoff_text::timestamptz THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
END
$$;

COMMENT ON FUNCTION titan.reject_activity_event_change() IS
  'Append-only guard for titan.activity_events (0011, carve-out 0028, superuser excluded by 0029).';

COMMIT;
