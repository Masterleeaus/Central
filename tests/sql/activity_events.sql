-- Activity history tests for migration 0011 (issue #36).
-- Run as a superuser against a database where migrations 0001-0009 and 0011 are applied:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/activity_events.sql "$DATABASE_URL"
-- Uses two fixed test organisations (f1, f2) and fixed event ids. Counts are limited to those, so the script
-- can run on a database that already holds other activity rows. Seeds, then checks: the writer cannot UPDATE, DELETE or TRUNCATE; the trigger rejects
-- those for the owner too; an organisation's reader sees only its own events; the writer cannot read other
-- tenants; oversized, nested and secret-shaped records are refused by CHECK constraints. Runs in one
-- transaction that is rolled back at the end.
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
  ('00000000-0000-4000-8000-0000000000f1', 'org-activity-a', 'active'),
  ('00000000-0000-4000-8000-0000000000f2', 'org-activity-b', 'active');

-- ---------------------------------------------------------------- writer: insert, provenance
SET LOCAL ROLE titan_trusted_writer;
INSERT INTO titan.activity_events (event_id, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail)
VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_admin_a', 'membership.create', 'membership', '00000000-0000-4000-8000-0000000000c1', 'central', 'success', 'req-activity-0001', '{"role":"manager"}');
INSERT INTO titan.activity_events (event_id, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail)
VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f2', 'subject', 'usr_admin_b', 'membership.create', 'membership', '00000000-0000-4000-8000-0000000000c2', 'lms', 'success', 'req-activity-0002', '{"applicationId":"academy"}');
RESET ROLE;
-- Counted as the superuser, which bypasses RLS: the writer has no read scope set here, so it could not see its own rows.
SELECT pg_temp.expect_count('writer inserted two events', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1')$s$, 2);
SELECT pg_temp.expect_count('writer rows carry server provenance (recorded_by = writer role)', $s$SELECT event_id FROM titan.activity_events WHERE recorded_by = 'titan_trusted_writer' AND organisation_id IN ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f2')$s$, 2);

-- ---------------------------------------------------------------- writer: UPDATE and DELETE are rejected
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_error_like('writer UPDATE is rejected', $s$UPDATE titan.activity_events SET outcome = 'failure'$s$, '%permission denied%');
SELECT pg_temp.expect_error_like('writer DELETE is rejected', $s$DELETE FROM titan.activity_events$s$, '%permission denied%');
SELECT pg_temp.expect_error_like('writer TRUNCATE is rejected', $s$TRUNCATE titan.activity_events$s$, '%permission denied%');
RESET ROLE;

-- ---------------------------------------------------------------- trigger rejects change for every role, including the owner
SELECT pg_temp.expect_error_like('owner UPDATE is rejected by trigger', $s$UPDATE titan.activity_events SET outcome = 'failure'$s$, '%append-only%');
SELECT pg_temp.expect_error_like('owner DELETE is rejected by trigger', $s$DELETE FROM titan.activity_events$s$, '%append-only%');
SELECT pg_temp.expect_error_like('owner TRUNCATE is rejected by trigger', $s$TRUNCATE titan.activity_events$s$, '%append-only%');
SELECT pg_temp.expect_count('events unchanged after rejected changes', $s$SELECT event_id FROM titan.activity_events WHERE event_id IN ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1') AND outcome = 'success'$s$, 2);

-- ---------------------------------------------------------------- reader: tenant scope
SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_count('reader with no organisation sees nothing', 'SELECT event_id FROM titan.activity_events', 0);
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000f1', true);
SELECT pg_temp.expect_count('organisation A reader sees only A events', 'SELECT event_id FROM titan.activity_events', 1);
SELECT pg_temp.expect_count('organisation A reader cannot read B event by id', $s$SELECT event_id FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000b1'$s$, 0);
SELECT pg_temp.expect_count('organisation A reader sees its own event by id', $s$SELECT event_id FROM titan.activity_events WHERE event_id = '00000000-0000-4000-8000-0000000000a1'$s$, 1);
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000f2', true);
SELECT pg_temp.expect_count('organisation B reader sees only B events', 'SELECT event_id FROM titan.activity_events', 1);
SELECT set_config('titan.organisation_id', 'not-a-uuid', true);
SELECT pg_temp.expect_error_like('reader fails closed on a malformed scope', 'SELECT event_id FROM titan.activity_events', '%invalid input syntax for type uuid%');
SELECT pg_temp.expect_error_like('reader cannot insert', $s$INSERT INTO titan.activity_events (event_id, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000f1', 'subject', 'u', 'membership.create', 'membership', 't', 'central', 'success', 'req-activity-9999')$s$, '%permission denied%');
SELECT pg_temp.expect_error_like('reader cannot update', $s$UPDATE titan.activity_events SET outcome = 'failure'$s$, '%permission denied%');
RESET ROLE;

-- ---------------------------------------------------------------- writer INSERT ... RETURNING needs the scoped read
-- Regression: the recorder must not use RETURNING. The scoped writer SELECT policy hides the new row from
-- the writer when no organisation is set, so RETURNING fails even though the INSERT policy allows it.
SET LOCAL ROLE titan_trusted_writer;
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_error_like('writer INSERT ... RETURNING fails without an organisation scope', $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_r', 'membership.create', 'membership', 't8', 'central', 'success', 'req-activity-0010') RETURNING event_id$s$, '%row-level security%');
RESET ROLE;

-- ---------------------------------------------------------------- writer read is tenant-scoped too
-- set_config(..., true) lasts for the whole transaction, so clear the scope left by the reader block first.
SELECT set_config('titan.organisation_id', '', true);
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_count('writer with no organisation scope reads nothing', 'SELECT event_id FROM titan.activity_events', 0);
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000f2', true);
SELECT pg_temp.expect_count('writer scoped to B reads only B events', 'SELECT event_id FROM titan.activity_events', 1);
RESET ROLE;

-- ---------------------------------------------------------------- tenant app has no privilege
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000f1', true);
SELECT pg_temp.expect_error_like('tenant app has no grant on activity events', 'SELECT event_id FROM titan.activity_events', '%permission denied%');
RESET ROLE;

-- ---------------------------------------------------------------- CHECK constraints refuse oversized, nested and secret-shaped records
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_error_like('oversized detail (over 1024 bytes) is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_big', 'membership.create', 'membership', 't1', 'central', 'success', 'req-activity-0003', (SELECT jsonb_object_agg('k' || g, repeat('x', 100)) FROM generate_series(1, 12) g))$s$,
  '%activity_events_detail_check%');
SELECT pg_temp.expect_error_like('nested detail is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_n', 'membership.create', 'membership', 't2', 'central', 'success', 'req-activity-0004', '{"a":{"b":1}}')$s$,
  '%activity_events_detail_check%');
SELECT pg_temp.expect_error_like('detail longer than 128 characters is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_l', 'membership.create', 'membership', 't3', 'central', 'success', 'req-activity-0005', jsonb_build_object('a', repeat('y', 129)))$s$,
  '%activity_events_detail_check%');
SELECT pg_temp.expect_error_like('email in actor is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'jo@example.com', 'membership.create', 'membership', 't4', 'central', 'success', 'req-activity-0006')$s$,
  '%activity_events_actor_id_check%');
SELECT pg_temp.expect_error_like('unknown source product is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_s', 'membership.create', 'membership', 't5', 'billing', 'success', 'req-activity-0007')$s$,
  '%activity_events_source_product_check%');
SELECT pg_temp.expect_error_like('action outside the dotted schema is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES ('00000000-0000-4000-8000-0000000000f1', 'subject', 'usr_a', 'Membership Create', 'membership', 't6', 'central', 'success', 'req-activity-0008')$s$,
  '%activity_events_action_check%');
SELECT pg_temp.expect_error_like('event for an unknown organisation is refused',
  $s$INSERT INTO titan.activity_events (organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id) VALUES ('00000000-0000-4000-8000-0000000000ff', 'subject', 'usr_o', 'membership.create', 'membership', 't7', 'central', 'success', 'req-activity-0009')$s$,
  '%activity_events_organisation_id_fkey%');
SELECT pg_temp.expect_count('no refused record was stored', $s$SELECT event_id FROM titan.activity_events WHERE actor_id IN ('usr_big','usr_n','usr_l','jo@example.com','usr_s','usr_a','usr_o')$s$, 0);
RESET ROLE;

ROLLBACK;
\echo Activity events tests passed
