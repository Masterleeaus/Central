-- Migration 0030: the 0028 retention carve-out must not apply to superusers (additive).
-- Applied after 0028. Migrations 0001 to 0028 are not edited.
--
-- Problem (found by tests/sql/activity_events_purge.sql, PR #109):
--   0028 tests pg_has_role(current_user, 'titan_retention_purger', 'MEMBER'). A superuser passes that
--   check with no explicit membership, so a superuser owner could DELETE an old titan.activity_events row
--   while titan.retention_cutoff was set.
--
-- Change: only reject-function body changes. CREATE OR REPLACE keeps the 0011 trigger and the 0028 comment.
--   * The carve-out needs the caller NOT to be a superuser, and an explicit membership: the caller is
--     titan_retention_purger itself (the purge job does SET LOCAL ROLE to it), or has a direct
--     pg_auth_members row for it.
--   * The other 0028 conditions are unchanged: DELETE only, cutoff set in the transaction, occurred_at older
--     than the cutoff.
--   * UPDATE, TRUNCATE and every other DELETE stay rejected for every role.
--   * No grants, policies or roles change.
--
-- Down-step (restores the 0028 function exactly). Run it inside one transaction, by a privileged operator:
--   BEGIN;
--   CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
--   LANGUAGE plpgsql
--   AS $$
--   DECLARE
--     cutoff_text text;
--   BEGIN
--     IF TG_OP = 'DELETE' AND pg_has_role(current_user, 'titan_retention_purger', 'MEMBER') THEN
--       cutoff_text := current_setting('titan.retention_cutoff', true);
--       IF cutoff_text IS NOT NULL AND cutoff_text <> '' AND OLD.occurred_at < cutoff_text::timestamptz THEN
--         RETURN OLD;
--       END IF;
--     END IF;
--     RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
--   END
--   $$;
--   COMMIT;
--
-- Known limit: a superuser can still SET ROLE titan_retention_purger. That is the designated purge path,
-- and it stays allowed only while a cutoff is set and only for rows older than it.
BEGIN;

CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff_text text;
  caller_is_superuser boolean;
  caller_is_purger boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT r.rolsuper INTO caller_is_superuser
      FROM pg_roles r
     WHERE r.rolname = current_user;

    -- Explicit membership only. pg_has_role() is not used because a superuser passes it with no membership.
    caller_is_purger := current_user = 'titan_retention_purger' OR EXISTS (
      SELECT 1
        FROM pg_auth_members am
        JOIN pg_roles g ON g.oid = am.roleid
        JOIN pg_roles u ON u.oid = am.member
       WHERE g.rolname = 'titan_retention_purger'
         AND u.rolname = current_user
    );

    IF COALESCE(caller_is_superuser, false) = false AND caller_is_purger THEN
      cutoff_text := current_setting('titan.retention_cutoff', true);
      IF cutoff_text IS NOT NULL AND cutoff_text <> '' AND OLD.occurred_at < cutoff_text::timestamptz THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
END
$$;

COMMIT;
