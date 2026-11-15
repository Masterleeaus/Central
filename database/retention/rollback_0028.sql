-- Rollback for migrations/0028_retention_purge.sql. Run by a privileged operator, not by the purge job.
-- Restores the migration 0011 trigger function exactly, removes the purger policies and grants, and drops the role
-- only when nothing depends on it. Run inside one transaction.
BEGIN;

DROP POLICY IF EXISTS activity_events_retention_select ON titan.activity_events;
DROP POLICY IF EXISTS activity_events_retention_delete ON titan.activity_events;

REVOKE SELECT, DELETE ON titan.activity_events FROM titan_retention_purger;
REVOKE SELECT, DELETE ON titan.provisioning_audit FROM titan_retention_purger;
REVOKE USAGE ON SCHEMA titan FROM titan_retention_purger;

CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_retention_purger')
     AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = 'titan_retention_purger') THEN
    DROP ROLE titan_retention_purger;
  END IF;
END
$$;

DELETE FROM public.schema_migrations WHERE version = 28;

COMMIT;
