-- Transactional outbox test for migration 0012 (and the schema it depends on, 0001 to 0009).
-- Run as a superuser against a database where migrations 0001-0009 and 0012 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/outbox.sql "$DATABASE_URL"
-- Any failed expectation raises an exception and psql exits non-zero. Everything runs in one transaction that
-- is rolled back at the end, so the database is left unchanged.
--
-- Covered here: atomicity of a state change with its outbox row (savepoint rollback), row bounds and
-- constraints, the status state machine and immutable identity fields, tenant isolation under row-level
-- security, consumer dedupe rows, and the claim statement (due rows, attempt counting, lease, dead rows skipped).
-- Not covered here: the TypeScript writer, publisher (backoff, dead path, signing, routing) and consumer helper.
-- Those are covered by packages/control-plane/test/outbox*.test.mjs with injected fakes, and were run against
-- PostgreSQL 16 through an out-of-tree harness (see docs/EVENTS.md, Verification).
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- helpers
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

-- The statement must succeed.
CREATE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'ok (allowed): %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL %: refused unexpectedly: %', label, SQLERRM;
END $$;

-- The statement must be refused (any error). A statement that succeeds is a failure.
CREATE FUNCTION pg_temp.expect_refused(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL %: statement succeeded but must be refused', label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
  RAISE NOTICE 'ok (refused): % [%]', label, SQLERRM;
END $$;

-- Claim statement of the publisher (outbox-publisher.ts claim): due pending rows, per-tenant head of line,
-- FOR UPDATE SKIP LOCKED, attempts + 1, lease. The expired-lease step that runs before it is in the TypeScript publisher.
CREATE FUNCTION pg_temp.claim_batch(batch integer, lease double precision, max_attempts integer) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  WITH due AS (
    SELECT e.id FROM titan.outbox_events e
     WHERE e.status = 'pending' AND e.next_attempt_at <= now() AND e.attempts < max_attempts
       AND NOT EXISTS (
         SELECT 1 FROM titan.outbox_events earlier
          WHERE earlier.organisation_id = e.organisation_id
            AND earlier.status = 'pending'
            AND (earlier.created_at, earlier.id) < (e.created_at, e.id))
     ORDER BY e.next_attempt_at, e.created_at
     LIMIT batch
     FOR UPDATE SKIP LOCKED)
  UPDATE titan.outbox_events e
     SET attempts = e.attempts + 1,
         next_attempt_at = now() + make_interval(secs => lease)
    FROM due
   WHERE e.id = due.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- seed (superuser, rolled back at the end)
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'outbox-test-org-a', 'active'),
  ('00000000-0000-4000-8000-0000000000b1', 'outbox-test-org-b', 'active');

-- ---------------------------------------------------------------- 1. atomicity
-- A state change and its outbox row share one transaction. Rolling back the state change removes the event.
SAVEPOINT atomic_rollback;
INSERT INTO titan.organisations (id, logto_organisation_id, state)
  VALUES ('00000000-0000-4000-8000-0000000000c1', 'outbox-test-org-c', 'active');
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest)
  VALUES ('00000000-0000-4000-8000-0000000000c1', 'desk', 'example', 1, 'corr-atomic-rb', 'atomic-rollback', '{"a":1}', repeat('0', 64));
ROLLBACK TO SAVEPOINT atomic_rollback;
SELECT pg_temp.expect_count('rolled-back state change leaves no outbox row', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'atomic-rollback'$q$, 0);
SELECT pg_temp.expect_count('rolled-back state change leaves no state row', $q$SELECT 1 FROM titan.organisations WHERE id = '00000000-0000-4000-8000-0000000000c1'$q$, 0);

SAVEPOINT atomic_commit;
INSERT INTO titan.organisations (id, logto_organisation_id, state)
  VALUES ('00000000-0000-4000-8000-0000000000c2', 'outbox-test-org-c2', 'active');
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest)
  VALUES ('00000000-0000-4000-8000-0000000000c2', 'desk', 'example', 1, 'corr-atomic-ok', 'atomic-commit', '{"a":1}', repeat('1', 64));
RELEASE SAVEPOINT atomic_commit;
SELECT pg_temp.expect_count('committed state change and outbox row both present', $q$SELECT 1 FROM titan.outbox_events e JOIN titan.organisations o ON o.id = e.organisation_id WHERE e.idempotency_key = 'atomic-commit'$q$, 1);

-- ---------------------------------------------------------------- 2. row bounds and constraints
SELECT pg_temp.expect_refused('organisation_id is required', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES (NULL, 'desk', 'example', 1, 'c', 'k-null-org', '{}', repeat('a',64))$q$);
SELECT pg_temp.expect_refused('source_product must be lowercase slug', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Desk', 'example', 1, 'c', 'k-src', '{}', repeat('a',64))$q$);
SELECT pg_temp.expect_refused('schema_version must be at least 1', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 0, 'c', 'k-ver', '{}', repeat('a',64))$q$);
SELECT pg_temp.expect_refused('payload must be an object', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-arr', '[1]', repeat('a',64))$q$);
SELECT pg_temp.expect_refused('payload over the size backstop is refused', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-big', jsonb_build_object('blob', repeat('x', 9000)), repeat('a',64))$q$);
SELECT pg_temp.expect_refused('digest must be 64 hex characters', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-digest', '{}', 'not-hex')$q$);
SELECT pg_temp.expect_refused('unknown status is refused', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, status) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-status', '{}', repeat('a',64), 'sent')$q$);
SELECT pg_temp.expect_refused('published requires published_at', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, status) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-pub', '{}', repeat('a',64), 'published')$q$);
SELECT pg_temp.expect_refused('last_error is bounded to 512 characters', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, last_error) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'k-err', '{}', repeat('a',64), repeat('e', 513))$q$);
SELECT pg_temp.expect_refused('idempotency key is unique', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'c', 'atomic-commit', '{}', repeat('a',64))$q$);
SELECT pg_temp.expect_refused('audit rows must name a known action', $q$INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor) SELECT id, organisation_id, 'deleted', 'x' FROM titan.outbox_events WHERE idempotency_key = 'atomic-commit'$q$);

-- ---------------------------------------------------------------- 3. state machine and immutable identity
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, status, attempts, next_attempt_at)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'sm-1', 'sm-pending', '{"a":1}', repeat('2',64), 'pending', 0, now() - interval '1 second');
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, status, attempts, next_attempt_at)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'sm-2', 'sm-dead', '{"a":2}', repeat('3',64), 'dead', 8, now());
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, status, attempts, published_at)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'sm-3', 'sm-published', '{"a":3}', repeat('4',64), 'published', 1, now());

SELECT pg_temp.expect_refused('payload cannot change after insert', $q$UPDATE titan.outbox_events SET payload = '{"a":99}' WHERE idempotency_key = 'sm-pending'$q$);
SELECT pg_temp.expect_refused('idempotency key cannot change', $q$UPDATE titan.outbox_events SET idempotency_key = 'changed' WHERE idempotency_key = 'sm-pending'$q$);
SELECT pg_temp.expect_refused('tenant cannot change', $q$UPDATE titan.outbox_events SET organisation_id = '00000000-0000-4000-8000-0000000000b1' WHERE idempotency_key = 'sm-pending'$q$);
SELECT pg_temp.expect_ok('pending may be published', $q$UPDATE titan.outbox_events SET status = 'published', published_at = now() WHERE idempotency_key = 'sm-pending'$q$);
SELECT pg_temp.expect_refused('published is terminal', $q$UPDATE titan.outbox_events SET status = 'pending' WHERE idempotency_key = 'sm-pending'$q$);
SELECT pg_temp.expect_refused('dead cannot be published directly', $q$UPDATE titan.outbox_events SET status = 'published', published_at = now() WHERE idempotency_key = 'sm-dead'$q$);
SELECT pg_temp.expect_ok('dead returns to pending by operator replay', $q$UPDATE titan.outbox_events SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE idempotency_key = 'sm-dead'$q$);
SELECT pg_temp.expect_count('replayed event has its retry budget back', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'sm-dead' AND status = 'pending' AND attempts = 0$q$, 1);

-- ---------------------------------------------------------------- 4. claim (publisher statement)
-- Due rows are claimed once: attempts goes up and the lease moves next_attempt_at forward.
-- Due at this point: sm-pending (pending, due) and sm-dead (replayed to pending, due). sm-published is excluded.
DO $$
DECLARE n bigint;
BEGIN
  SET LOCAL ROLE titan_trusted_writer;
  n := pg_temp.claim_batch(50, 60, 8);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL claim: expected 2 due rows, got %', n; END IF;
  RAISE NOTICE 'ok: claim returned the 2 due pending rows and not the published row';
  n := pg_temp.claim_batch(50, 60, 8);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL lease: leased rows were claimed again (% rows)', n; END IF;
  RAISE NOTICE 'ok: leased rows are not claimed again before the lease ends';
END $$;
SELECT pg_temp.expect_count('claim increments attempts and sets a lease', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'sm-dead' AND attempts = 1 AND next_attempt_at > now() + interval '50 seconds'$q$, 1);

-- An event at the attempt limit is not claimed; the publisher marks it dead instead.
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, attempts, next_attempt_at)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 'desk', 'example', 1, 'lim-1', 'limit-row', '{"a":4}', repeat('5',64), 8, now() - interval '1 second');
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.claim_batch(50, 60, 8);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL limit: row at the attempt limit was claimed (% rows)', n; END IF;
  RAISE NOTICE 'ok: row at the attempt limit is not claimed';
END $$;

-- ---------------------------------------------------------------- 4b. per-tenant order (head of line)
-- A tenant's later event is never claimed while an earlier pending event of the same tenant exists. A backed-off or
-- leased head holds its tenant back. A dead head does not (dead is not pending); its later events go out.
-- Seeded with explicit created_at values, so the order does not depend on transaction start times.
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES ('00000000-0000-4000-8000-0000000000d1', 'outbox-test-org-d', 'active');
INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest, created_at, next_attempt_at)
  VALUES ('00000000-0000-4000-8000-0000000000d1', 'desk', 'example', 1, 'ord', 'order-1', '{"n":1}', repeat('9',64), timestamptz '2030-01-01 00:00:01+00', now() - interval '1 second'),
         ('00000000-0000-4000-8000-0000000000d1', 'desk', 'example', 1, 'ord', 'order-2', '{"n":2}', repeat('b',64), timestamptz '2030-01-01 00:00:02+00', now() - interval '1 second'),
         ('00000000-0000-4000-8000-0000000000d1', 'desk', 'example', 1, 'ord', 'order-3', '{"n":3}', repeat('c',64), timestamptz '2030-01-01 00:00:03+00', now() - interval '1 second');

DO $$ BEGIN SET LOCAL ROLE titan_trusted_writer; PERFORM pg_temp.claim_batch(50, 60, 8); END $$;
SELECT pg_temp.expect_count('order: the head event of the tenant is claimed', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'order-1' AND attempts = 1$q$, 1);
SELECT pg_temp.expect_count('order: later events wait behind the leased head', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key IN ('order-2', 'order-3') AND attempts = 0$q$, 2);

UPDATE titan.outbox_events SET next_attempt_at = now() + interval '300 seconds' WHERE idempotency_key = 'order-1';
DO $$ BEGIN PERFORM pg_temp.claim_batch(50, 60, 8); END $$;
SELECT pg_temp.expect_count('order: a backed-off head holds back the whole tenant', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key IN ('order-2', 'order-3') AND attempts = 0$q$, 2);

UPDATE titan.outbox_events SET next_attempt_at = now() - interval '1 second' WHERE idempotency_key = 'order-1';
DO $$ BEGIN PERFORM pg_temp.claim_batch(50, 60, 8); END $$;
SELECT pg_temp.expect_count('order: the head is retried before anything after it', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'order-1' AND attempts = 2$q$, 1);
SELECT pg_temp.expect_count('order: retry of the head does not release later events', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key IN ('order-2', 'order-3') AND attempts = 0$q$, 2);

UPDATE titan.outbox_events SET status = 'published', published_at = now() WHERE idempotency_key = 'order-1';
DO $$ BEGIN PERFORM pg_temp.claim_batch(50, 60, 8); END $$;
SELECT pg_temp.expect_count('order: after the head is published the next event is claimed', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'order-2' AND attempts = 1$q$, 1);
SELECT pg_temp.expect_count('order: the event after it still waits', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'order-3' AND attempts = 0$q$, 1);

UPDATE titan.outbox_events SET status = 'dead', last_error = 'test: dead letter' WHERE idempotency_key = 'order-2';
DO $$ BEGIN PERFORM pg_temp.claim_batch(50, 60, 8); END $$;
SELECT pg_temp.expect_count('order: a dead head does not block the tenant', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'order-3' AND attempts = 1$q$, 1);

-- ---------------------------------------------------------------- 5. tenant isolation under RLS
-- Tenant role, scope A: sees and writes only organisation A.
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000a1', true);
SELECT pg_temp.expect_count('tenant A sees only its own outbox rows', $q$SELECT 1 FROM titan.outbox_events$q$, 3);
SELECT pg_temp.expect_ok('tenant A inserts its own event', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'rls-a', 'rls-a-1', '{"a":5}', repeat('6',64))$q$);
SELECT pg_temp.expect_refused('tenant A cannot insert for tenant B', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000b1', 'desk', 'example', 1, 'rls-x', 'rls-b-1', '{"a":6}', repeat('7',64))$q$);
SELECT pg_temp.expect_refused('tenant A cannot update outbox rows (no grant)', $q$UPDATE titan.outbox_events SET status = 'dead'$q$);
SELECT pg_temp.expect_refused('tenant A cannot delete outbox rows (no grant)', $q$DELETE FROM titan.outbox_events$q$);
SELECT pg_temp.expect_refused('tenant A cannot read the audit table', $q$SELECT 1 FROM titan.outbox_event_audit$q$);
SELECT pg_temp.expect_ok('tenant A records its consumer dedupe key', $q$INSERT INTO titan.outbox_processed_events (consumer, idempotency_key, organisation_id, event_id) SELECT 'desk-inbox', 'rls-a-1', '00000000-0000-4000-8000-0000000000a1', id FROM titan.outbox_events WHERE idempotency_key = 'rls-a-1'$q$);
SELECT pg_temp.expect_refused('tenant A cannot record a dedupe key for tenant B', $q$INSERT INTO titan.outbox_processed_events (consumer, idempotency_key, organisation_id, event_id) VALUES ('desk-inbox', 'rls-b-2', '00000000-0000-4000-8000-0000000000b1', gen_random_uuid())$q$);
SELECT pg_temp.expect_refused('duplicate consumer key is refused', $q$INSERT INTO titan.outbox_processed_events (consumer, idempotency_key, organisation_id, event_id) VALUES ('desk-inbox', 'rls-a-1', '00000000-0000-4000-8000-0000000000a1', gen_random_uuid())$q$);

-- No scope set: fail closed, nothing is visible and nothing may be written.
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('no tenant scope sees no outbox rows', $q$SELECT 1 FROM titan.outbox_events$q$, 0);
SELECT pg_temp.expect_refused('no tenant scope cannot insert', $q$INSERT INTO titan.outbox_events (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest) VALUES ('00000000-0000-4000-8000-0000000000a1', 'desk', 'example', 1, 'rls-none', 'rls-none-1', '{}', repeat('8',64))$q$);
RESET ROLE;

-- Tenant B cannot see tenant A's row even when it knows the idempotency key.
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-0000000000b1', true);
SELECT pg_temp.expect_count('tenant B cannot see tenant A events', $q$SELECT 1 FROM titan.outbox_events WHERE idempotency_key = 'rls-a-1'$q$, 0);
SELECT pg_temp.expect_count('tenant B cannot see tenant A dedupe rows', $q$SELECT 1 FROM titan.outbox_processed_events WHERE consumer = 'desk-inbox' AND idempotency_key = 'rls-a-1'$q$, 0);
RESET ROLE;

-- ---------------------------------------------------------------- 6. indexes exist
SELECT pg_temp.expect_count('pending work index exists', $q$SELECT 1 FROM pg_indexes WHERE schemaname = 'titan' AND indexname = 'outbox_events_pending_idx' AND indexdef LIKE '%WHERE (status = ''pending''::text)%'$q$, 1);
SELECT pg_temp.expect_count('dead-letter index exists', $q$SELECT 1 FROM pg_indexes WHERE schemaname = 'titan' AND indexname = 'outbox_events_dead_idx'$q$, 1);

ROLLBACK;
\echo 'outbox.sql: all expectations passed (transaction rolled back)'
