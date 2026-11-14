-- Migration 0028: retention purge path for access-decision and audit rows (issue #16, 90-day retention).
-- Applied after 0027. Migrations 0001 to 0027 are not edited.
--
-- Scope of change:
--   * New NOLOGIN role titan_retention_purger. Nothing is granted to any existing role.
--   * DELETE and SELECT on titan.activity_events and titan.provisioning_audit for that role only.
--   * One carve-out in titan.reject_activity_event_change (migration 0011). A DELETE is allowed only when ALL hold:
--       1. current_user is a member of titan_retention_purger;
--       2. the purge transaction set titan.retention_cutoff (transaction-local, via set_config);
--       3. the row's occurred_at is older than that cutoff.
--     UPDATE, TRUNCATE and every other DELETE stay rejected for every role, including the owner.
--   * Row-level security policies for titan_retention_purger only, bounded by the same cutoff.
--     With no cutoff set, the policy matches no rows (fail closed).
--
-- Review this carve-out before applying it. The purge job is tools/retention_purge.py and is dry-run by default.
-- Rollback: database/retention/rollback_0028.sql.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_retention_purger') THEN
    CREATE ROLE titan_retention_purger NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA titan TO titan_retention_purger;
GRANT SELECT, DELETE ON titan.activity_events TO titan_retention_purger;
GRANT SELECT, DELETE ON titan.provisioning_audit TO titan_retention_purger;

-- Carve-out. Same behaviour as migration 0011 for every caller that is not a purger inside a cutoff transaction.
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

CREATE POLICY activity_events_retention_select ON titan.activity_events FOR SELECT TO titan_retention_purger
  USING (occurred_at < NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz);
CREATE POLICY activity_events_retention_delete ON titan.activity_events FOR DELETE TO titan_retention_purger
  USING (occurred_at < NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz);

COMMENT ON FUNCTION titan.reject_activity_event_change() IS
  'Append-only guard for titan.activity_events (0011). Migration 0028 allows purger DELETE of rows older than titan.retention_cutoff.';

COMMIT;
