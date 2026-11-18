-- Retention purge test for migration 0028 (issue #16).
-- Covers the carve-out in titan.reject_activity_event_change() and the purger row-level security policies.
--
-- Run as a superuser against a database where migrations 0001-0028 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/retention_purge_0028.sql "$DATABASE_URL"
-- or through tests/test_retention_purge_0028_db.py with TITAN_TEST_DATABASE_URL set.
--
-- Everything runs in one transaction that is rolled back at the end, so the database is left unchanged.
-- Any check that fails raises an exception and psql exits non-zero.
\set ON_ERROR_STOP on
BEGIN;

-- Runs the statement and expects it to be refused for any reason.
CREATE FUNCTION pg_temp.expect_rejected(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  RAISE EXCEPTION 'not rejected: %', label USING ERRCODE = 'P0002';
END
$$;

-- Runs the statement and expects exactly expected rows to be affected.
CREATE FUNCTION pg_temp.expect_affected(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: affected % rows, expected %', label, n, expected USING ERRCODE = 'P0002';
  END IF;
END
$$;

-- Counts the rows a statement returns and expects expected of them.
CREATE FUNCTION pg_temp.expect_visible(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: saw % rows, expected %', label, n, expected USING ERRCODE = 'P0002';
  END IF;
END
$$;

-- Seed one organisation with an old row (400 days) and a recent row. Inserts are allowed by the append-only trigger.
INSERT INTO titan.organisations (id, logto_organisation_id, state)
VALUES ('00000000-0000-4000-8000-000000000028', 'ret-test-org-0028', 'active');

INSERT INTO titan.activity_events (occurred_at, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id)
VALUES
  (now() - interval '400 days', '00000000-0000-4000-8000-000000000028', 'service', 'retention-test', 'access.check', 'organisation', 'ret-target-0028', 'central', 'success', 'ret-corr-0028-old'),
  (now(), '00000000-0000-4000-8000-000000000028', 'service', 'retention-test', 'access.check', 'organisation', 'ret-target-0028', 'central', 'success', 'ret-corr-0028-new');

-- A non-member role that bypasses RLS reaches the trigger. It is refused for every change, even with a cutoff set.
-- The role is created inside this transaction, so the rollback removes it.
-- Note: the role creator is a member of roles it creates (PostgreSQL 16), so the creating superuser is not used here.
CREATE ROLE titan_retention_outsider NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA titan TO titan_retention_outsider;
GRANT SELECT, UPDATE, DELETE ON titan.activity_events TO titan_retention_outsider;
SELECT set_config('titan.retention_cutoff', (now() - interval '365 days')::text, true);
SET LOCAL ROLE titan_retention_outsider;
SELECT pg_temp.expect_rejected('non-member delete of old row', $q$DELETE FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-old'$q$);
SELECT pg_temp.expect_rejected('non-member update', $q$UPDATE titan.activity_events SET outcome = 'failure' WHERE correlation_id = 'ret-corr-0028-old'$q$);
RESET ROLE;
SELECT pg_temp.expect_rejected('superuser truncate', 'TRUNCATE titan.activity_events');

-- 2. The purger with no cutoff sees nothing and deletes nothing (fail closed).
SELECT set_config('titan.retention_cutoff', '', true);
SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_visible('purger without cutoff sees rows', $q$SELECT 1 FROM titan.activity_events WHERE correlation_id LIKE 'ret-corr-0028-%'$q$, 0);
SELECT pg_temp.expect_affected('purger without cutoff deletes', $q$DELETE FROM titan.activity_events WHERE correlation_id LIKE 'ret-corr-0028-%'$q$, 0);
RESET ROLE;

-- 3. The purger with the cutoff sees and deletes only rows older than it.
SELECT set_config('titan.retention_cutoff', (now() - interval '365 days')::text, true);
SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_visible('purger with cutoff sees old row only', $q$SELECT 1 FROM titan.activity_events WHERE correlation_id LIKE 'ret-corr-0028-%'$q$, 1);
SELECT pg_temp.expect_affected('purger skips recent row', $q$DELETE FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-new'$q$, 0);
SELECT pg_temp.expect_affected('purger deletes old row', $q$DELETE FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-old'$q$, 1);
-- The purger has no UPDATE, TRUNCATE or delete rights on anything else.
SELECT pg_temp.expect_rejected('purger update', $q$UPDATE titan.activity_events SET outcome = 'failure'$q$);
SELECT pg_temp.expect_rejected('purger truncate', 'TRUNCATE titan.activity_events');
SELECT pg_temp.expect_rejected('purger delete of organisations', $q$DELETE FROM titan.organisations WHERE id = '00000000-0000-4000-8000-000000000028'$q$);
RESET ROLE;

-- 4. After the purge: the old row is gone, the recent row stays, and the non-member is still refused.
SELECT pg_temp.expect_visible('old row removed', $q$SELECT 1 FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-old'$q$, 0);
SELECT pg_temp.expect_visible('recent row kept', $q$SELECT 1 FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-new'$q$, 1);
SET LOCAL ROLE titan_retention_outsider;
SELECT pg_temp.expect_rejected('non-member delete of recent row', $q$DELETE FROM titan.activity_events WHERE correlation_id = 'ret-corr-0028-new'$q$);
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'retention purge 0028: all checks passed'; END $$;

ROLLBACK;
