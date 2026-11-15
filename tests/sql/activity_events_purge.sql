-- Retention purge tests for migration 0028 (carve-out in the append-only trigger on titan.activity_events).
-- Run as a superuser against a database where migrations 0001-0028 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/activity_events_purge.sql "$DATABASE_URL"
-- Seeds two rows older than the 90-day window and one recent row, then checks that:
--   * the purge role deletes only rows older than titan.retention_cutoff, through the same statement shape
--     as tools/retention_purge.py (build_batch_sql);
--   * with no cutoff, or an empty cutoff, the purge role deletes nothing;
--   * every other DELETE, UPDATE and TRUNCATE is still rejected: for the owner (by the trigger, even with a cutoff
--     set), for the purge role (by its grants), and for the writer, reader and tenant roles (by their grants).
-- Runs in one transaction that is rolled back at the end.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_count(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- For statements that return one scalar, such as WITH ... DELETE ... RETURNING and count(*) over it.
CREATE FUNCTION pg_temp.expect_scalar(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- The statement must fail, and the error text must match pattern (LIKE). A success is a failure.
CREATE FUNCTION pg_temp.expect_error_like(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL expected an error: %', label;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL expected an error%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE pattern THEN
      RAISE EXCEPTION 'FAIL %: unexpected error: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok (error): %', label;
END $$;

-- ---------------------------------------------------------------- seed (superuser)
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'org-purge-test', 'active');
INSERT INTO titan.activity_events (event_id, occurred_at, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id)
VALUES
  ('00000000-0000-4000-8000-0000000000d1', now() - interval '120 days', '00000000-0000-4000-8000-0000000000e1', 'subject', 'usr_purge_a', 'membership.create', 'membership', 'p1', 'central', 'success', 'req-purge-0001'),
  ('00000000-0000-4000-8000-0000000000d2', now() - interval '120 days', '00000000-0000-4000-8000-0000000000e1', 'subject', 'usr_purge_b', 'membership.create', 'membership', 'p2', 'central', 'success', 'req-purge-0002'),
  ('00000000-0000-4000-8000-0000000000d3', now() - interval '1 day',    '00000000-0000-4000-8000-0000000000e1', 'subject', 'usr_purge_c', 'membership.create', 'membership', 'p3', 'central', 'success', 'req-purge-0003');
SELECT pg_temp.expect_count('three fixture events seeded', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3')$s$, 3);

-- ---------------------------------------------------------------- purge role, no cutoff: fail closed
SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_scalar('purge role with no cutoff set deletes nothing',
  $s$WITH removed AS (DELETE FROM titan.activity_events WHERE organisation_id = '00000000-0000-4000-8000-0000000000e1' RETURNING 1) SELECT count(*) FROM removed$s$, 0);
SELECT set_config('titan.retention_cutoff', '', true);
SELECT pg_temp.expect_scalar('purge role with an empty cutoff deletes nothing',
  $s$WITH removed AS (DELETE FROM titan.activity_events WHERE organisation_id = '00000000-0000-4000-8000-0000000000e1' RETURNING 1) SELECT count(*) FROM removed$s$, 0);
RESET ROLE;
SELECT pg_temp.expect_count('fail-closed: all three fixture events still present', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3')$s$, 3);

-- The 90-day cutoff, set the same way as tools/retention_purge.py (_setup), transaction-local.
SELECT set_config('titan.retention_cutoff', (now() - make_interval(days => 90))::text, true);

-- ---------------------------------------------------------------- owner: trigger rejects every DELETE, UPDATE and TRUNCATE, even with a cutoff set
SELECT pg_temp.expect_error_like('owner DELETE of an old event is rejected with a cutoff set', $s$DELETE FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%append-only%');
SELECT pg_temp.expect_error_like('owner UPDATE of an old event is rejected with a cutoff set', $s$UPDATE titan.activity_events SET outcome = 'failure' WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%append-only%');
SELECT pg_temp.expect_error_like('owner TRUNCATE is rejected with a cutoff set', $s$TRUNCATE titan.activity_events$s$, '%append-only%');
SELECT pg_temp.expect_count('owner rejections left all fixture events in place', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3')$s$, 3);

-- ---------------------------------------------------------------- other roles: no DELETE grant, so denied with a cutoff set
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_error_like('writer DELETE is rejected with a cutoff set', $s$DELETE FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%permission denied%');
RESET ROLE;
SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_error_like('reader DELETE is rejected with a cutoff set', $s$DELETE FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%permission denied%');
RESET ROLE;
SET LOCAL ROLE titan_tenant_app;
SELECT pg_temp.expect_error_like('tenant app DELETE is rejected with a cutoff set', $s$DELETE FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%permission denied%');
RESET ROLE;

-- ---------------------------------------------------------------- purge role: UPDATE and TRUNCATE are denied even with a cutoff set
SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_error_like('purge role UPDATE is rejected', $s$UPDATE titan.activity_events SET outcome = 'failure' WHERE event_id = '00000000-0000-4000-8000-0000000000d1'$s$, '%permission denied%');
SELECT pg_temp.expect_error_like('purge role TRUNCATE is rejected', $s$TRUNCATE titan.activity_events$s$, '%permission denied%');
-- A recent event is outside the cutoff: the purge role cannot delete it.
SELECT pg_temp.expect_scalar('purge role cannot delete a recent event',
  $s$WITH removed AS (DELETE FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d3' RETURNING 1) SELECT count(*) FROM removed$s$, 0);
RESET ROLE;

-- ---------------------------------------------------------------- the purge path itself
-- Mirrors build_batch_sql in tools/retention_purge.py: one batch, DELETE ... USING victims by ctid, with the cutoff set.
-- Baseline first: every row older than the cutoff. The purge role's policy is cutoff-only, so a batch with a large
-- enough batch size must remove exactly this many rows.
SELECT count(*) AS old_n FROM titan.activity_events WHERE occurred_at < NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz \gset
SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_scalar('purge batch removes every event older than the cutoff',
  $s$WITH victims AS (SELECT ctid FROM titan.activity_events WHERE occurred_at < NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz ORDER BY occurred_at LIMIT 100000), removed AS (DELETE FROM titan.activity_events t USING victims v WHERE t.ctid = v.ctid RETURNING 1) SELECT count(*) FROM removed$s$,
  :old_n);
RESET ROLE;
SELECT pg_temp.expect_count('purge removed both 120-day-old fixture events', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2')$s$, 0);
SELECT pg_temp.expect_count('purge kept the recent fixture event', $s$SELECT event_id FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000d3'$s$, 1);
SELECT pg_temp.expect_count('no event older than the cutoff remains', $s$SELECT event_id FROM titan.activity_events WHERE occurred_at < NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz$s$, 0);

ROLLBACK;
\echo Activity events purge tests passed
