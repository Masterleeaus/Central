-- Onboarding state machine, uniqueness, immutability, audit and tenant isolation for migration 0017.
-- Run against a database where migrations 0001-0009, 0014 and 0017 are applied, as a superuser:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/onboarding_states.sql "$DATABASE_URL"
-- Canonical rows (organisations, identities, memberships, entitlements, links) are seeded as superuser.
-- The onboarding lifecycle then runs as titan_trusted_writer, so the grants are exercised, not bypassed.
-- Every rejection is checked against its SQLSTATE. Any accepted invalid write, wrong SQLSTATE or
-- cross-tenant row raises an exception and psql exits non-zero. Everything rolls back at the end.
\set ON_ERROR_STOP on
BEGIN;

-- The application sets these per transaction. The fixed request ID is only for this test run.
SELECT set_config('titan.actor_subject', 'ops_test', true);
SELECT set_config('titan.request_id', '99999999-0000-4000-8000-000000000001', true);

-- Helper: the statement must fail with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.expect_sqlstate(label text, stmt text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL %: statement was accepted', label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got % (%)', label, want, SQLSTATE, SQLERRM;
  END IF;
  RAISE NOTICE 'ok: % rejected (%)', label, SQLSTATE;
END $$;

-- Helper: the onboarding must be in the expected state. Catches an UPDATE that matched no rows.
CREATE FUNCTION pg_temp.expect_state(label text, onboarding uuid, want text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  SELECT state INTO got FROM titan.onboardings WHERE id = onboarding;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: state is %, expected %', label, got, want;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- Helper: a query must return exactly the expected count for the current role and settings.
CREATE FUNCTION pg_temp.expect_count(label text, q text, want bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || q || ') AS visible' INTO n;
  IF n IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, want, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- Seed canonical rows as superuser (bypasses RLS and triggers' role checks for seeding only).
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'logto_org_a', 'active'),
  ('b1000000-0000-4000-8000-000000000001', 'logto_org_b', 'active');
INSERT INTO titan.identities (id, logto_subject, state) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'owner_a', 'active'),
  ('b2000000-0000-4000-8000-000000000001', 'owner_b', 'active');
-- Owner A is an active owner of org A. Owner B has no membership, so org B cannot reach provisioned.
INSERT INTO titan.memberships (id, identity_id, organisation_id, role, state) VALUES
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', 'active');
INSERT INTO titan.entitlements (id, organisation_id, application_id, state, features) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'desk', 'active', '{}'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'field', 'active', '{}'),
  ('e1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'desk', 'active', '{}');

-- ---- Lifecycle as the trusted writer (least-privilege role) ----
SET ROLE titan_trusted_writer;

-- Negative: the state CHECK and the starting-state rule.
SELECT pg_temp.expect_sqlstate('unknown state rejected on insert',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-0000000000ff','onboarding-key-x-000','a1000000-0000-4000-8000-0000000000ff','logto_org_x','owner_x','Bad State',ARRAY['desk'],repeat('a',64),'done')$q$, '23514');
SELECT pg_temp.expect_sqlstate('onboarding cannot start verified',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state, owner_proof_at, owner_proof_digest)
     VALUES ('a3000000-0000-4000-8000-0000000000fe','onboarding-key-x-001','a1000000-0000-4000-8000-0000000000fe','logto_org_xx','owner_x','Skip Proof',ARRAY['desk'],repeat('a',64),'verified',now(),repeat('b',64))$q$, '23514');
SELECT pg_temp.expect_sqlstate('product outside the enumerated set rejected',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-0000000000fd','onboarding-key-x-002','a1000000-0000-4000-8000-0000000000fd','logto_org_xy','owner_x','Bad Product',ARRAY['lms'],repeat('a',64),'pending')$q$, '23514');
SELECT pg_temp.expect_sqlstate('short idempotency key rejected',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-0000000000fc','short','a1000000-0000-4000-8000-0000000000fc','logto_org_xz','owner_x','Short Key',ARRAY['desk'],repeat('a',64),'pending')$q$, '23514');

-- Positive: the first onboarding (org A, products desk and field) starts pending.
INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
VALUES ('a3000000-0000-4000-8000-000000000001', 'onboarding-key-a-001', 'a1000000-0000-4000-8000-000000000001', 'logto_org_a', 'owner_a', 'Acme Field Services', ARRAY['desk','field'], repeat('a',64), 'pending');
\echo ok: pending onboarding inserted

-- Uniqueness: a retry cannot create a second onboarding, organisation or Logto organisation mapping.
SELECT pg_temp.expect_sqlstate('duplicate idempotency key rejected',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-000000000002','onboarding-key-a-001','c1000000-0000-4000-8000-000000000001','logto_org_c','owner_c','Dup Key',ARRAY['desk'],repeat('a',64),'pending')$q$, '23505');
SELECT pg_temp.expect_sqlstate('duplicate organisation rejected',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-000000000003','onboarding-key-c-001','a1000000-0000-4000-8000-000000000001','logto_org_c2','owner_c','Dup Org',ARRAY['desk'],repeat('a',64),'pending')$q$, '23505');
SELECT pg_temp.expect_sqlstate('duplicate Logto organisation mapping rejected',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('a3000000-0000-4000-8000-000000000004','onboarding-key-c-002','c1000000-0000-4000-8000-000000000002','logto_org_a','owner_c','Dup Logto',ARRAY['desk'],repeat('a',64),'pending')$q$, '23505');

-- Transitions. Pending cannot skip verification, and verification needs the owner's proof.
SELECT pg_temp.expect_sqlstate('pending to provisioned rejected',
  $q$UPDATE titan.onboardings SET state='provisioned' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('pending to verified without owner proof rejected',
  $q$UPDATE titan.onboardings SET state='verified' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
UPDATE titan.onboardings SET state='verified', owner_proof_at=now(), owner_proof_digest=repeat('b',64)
 WHERE id='a3000000-0000-4000-8000-000000000001';
\echo ok: owner proof recorded, pending to verified
SELECT pg_temp.expect_state('onboarding A is verified', 'a3000000-0000-4000-8000-000000000001', 'verified');
SELECT pg_temp.expect_sqlstate('owner proof cannot be replaced',
  $q$UPDATE titan.onboardings SET owner_proof_digest=repeat('c',64) WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('owner subject cannot be changed',
  $q$UPDATE titan.onboardings SET owner_logto_subject='someone_else' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('requested organisation name cannot be changed',
  $q$UPDATE titan.onboardings SET organisation_name='Renamed' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');

-- Product results. A product must be selected; an entitlement must belong to this organisation and product.
SELECT pg_temp.expect_sqlstate('unselected product result rejected',
  $q$INSERT INTO titan.onboarding_product_results (onboarding_id, organisation_id, application_id, outcome, failure_code)
     VALUES ('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','academy','failed','conflict')$q$, '23514');
INSERT INTO titan.onboarding_product_results (onboarding_id, organisation_id, application_id, outcome, entitlement_id, entitlement_request_id)
VALUES ('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','desk','succeeded','e1000000-0000-4000-8000-000000000001','99999999-0000-4000-8000-0000000000d1');
INSERT INTO titan.onboarding_product_results (onboarding_id, organisation_id, application_id, outcome, failure_code)
VALUES ('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','field','failed','provisioning_unavailable');
\echo ok: desk succeeded, field structured failure recorded
SELECT pg_temp.expect_sqlstate('provisioned rejected while a product has failed',
  $q$UPDATE titan.onboardings SET state='provisioned' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('entitlement of another organisation rejected',
  $q$UPDATE titan.onboarding_product_results SET outcome='succeeded', failure_code=NULL, entitlement_id='e1000000-0000-4000-8000-000000000003',
     entitlement_request_id='99999999-0000-4000-8000-0000000000d2' WHERE onboarding_id='a3000000-0000-4000-8000-000000000001' AND application_id='field'$q$, '23514');
UPDATE titan.onboarding_product_results SET outcome='succeeded', failure_code=NULL, entitlement_id='e1000000-0000-4000-8000-000000000002',
   entitlement_request_id='99999999-0000-4000-8000-0000000000d3', attempts=2
 WHERE onboarding_id='a3000000-0000-4000-8000-000000000001' AND application_id='field';
\echo ok: field resumed to succeeded with its own entitlement
SELECT pg_temp.expect_sqlstate('a granted result cannot become a failure',
  $q$UPDATE titan.onboarding_product_results SET outcome='failed', failure_code='conflict', entitlement_id=NULL, entitlement_request_id=NULL
     WHERE onboarding_id='a3000000-0000-4000-8000-000000000001' AND application_id='field'$q$, '23514');

-- Provisioned: every selected product succeeded, the organisation is canonical, and the owner's membership is active.
UPDATE titan.onboardings SET state='provisioned' WHERE id='a3000000-0000-4000-8000-000000000001';
\echo ok: verified to provisioned
SELECT pg_temp.expect_state('onboarding A is provisioned', 'a3000000-0000-4000-8000-000000000001', 'provisioned');
SELECT pg_temp.expect_sqlstate('provisioned is terminal',
  $q$UPDATE titan.onboardings SET state='verified' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('product result cannot change after provisioning',
  $q$UPDATE titan.onboarding_product_results SET attempts=5 WHERE onboarding_id='a3000000-0000-4000-8000-000000000001' AND application_id='desk'$q$, '23514');

-- Second onboarding (org B). Owner B has no membership, so the core step fails and the path is failed, rolled back.
INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
VALUES ('b3000000-0000-4000-8000-000000000001', 'onboarding-key-b-001', 'b1000000-0000-4000-8000-000000000001', 'logto_org_b', 'owner_b', 'Beta Works', ARRAY['desk'], repeat('b',64), 'pending');
UPDATE titan.onboardings SET state='verified', owner_proof_at=now(), owner_proof_digest=repeat('d',64) WHERE id='b3000000-0000-4000-8000-000000000001';
INSERT INTO titan.onboarding_product_results (onboarding_id, organisation_id, application_id, outcome, entitlement_id, entitlement_request_id)
VALUES ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','desk','succeeded','e1000000-0000-4000-8000-000000000003','99999999-0000-4000-8000-0000000000e1');
SELECT pg_temp.expect_sqlstate('provisioned rejected without an owner membership',
  $q$UPDATE titan.onboardings SET state='provisioned' WHERE id='b3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('failure without a structured code rejected',
  $q$UPDATE titan.onboardings SET state='failed' WHERE id='b3000000-0000-4000-8000-000000000001'$q$, '23514');
UPDATE titan.onboardings SET state='failed', failure_code='core_provisioning_failed' WHERE id='b3000000-0000-4000-8000-000000000001';
-- Resume is allowed while not rolled back. Then it fails again so that rollback can be exercised.
UPDATE titan.onboardings SET state='verified' WHERE id='b3000000-0000-4000-8000-000000000001';
UPDATE titan.onboardings SET state='failed', failure_code='core_provisioning_failed' WHERE id='b3000000-0000-4000-8000-000000000001';
\echo ok: failed to verified (resume) and back to failed
SELECT pg_temp.expect_state('onboarding B is failed before rollback', 'b3000000-0000-4000-8000-000000000001', 'failed');
-- Rollback: revoke first. A rollback mark on a still-active grant is rejected.
SELECT pg_temp.expect_sqlstate('rollback mark rejected while entitlement is active',
  $q$UPDATE titan.onboarding_product_results SET rolled_back_at=now() WHERE onboarding_id='b3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('onboarding rollback rejected while a grant is open',
  $q$UPDATE titan.onboardings SET rolled_back_at=now() WHERE id='b3000000-0000-4000-8000-000000000001'$q$, '23514');
UPDATE titan.entitlements SET state='revoked', revision=revision+1 WHERE id='e1000000-0000-4000-8000-000000000003';
UPDATE titan.onboarding_product_results SET rolled_back_at=now() WHERE onboarding_id='b3000000-0000-4000-8000-000000000001';
UPDATE titan.onboardings SET rolled_back_at=now() WHERE id='b3000000-0000-4000-8000-000000000001';
\echo ok: rollback after revocation
SELECT pg_temp.expect_state('onboarding B stays failed after rollback', 'b3000000-0000-4000-8000-000000000001', 'failed');
SELECT pg_temp.expect_sqlstate('rolled back onboarding cannot resume',
  $q$UPDATE titan.onboardings SET state='verified' WHERE id='b3000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT pg_temp.expect_sqlstate('rollback cannot be undone',
  $q$UPDATE titan.onboardings SET rolled_back_at=NULL WHERE id='b3000000-0000-4000-8000-000000000001'$q$, '23514');

-- Audit: every state change is an event, written in the same transaction with the actor and request ID.
SELECT pg_temp.expect_count('onboarding A has started, owner_proved and provisioned events',
  $q$SELECT 1 FROM titan.onboarding_events WHERE onboarding_id='a3000000-0000-4000-8000-000000000001' AND actor_subject='ops_test' AND request_id='99999999-0000-4000-8000-000000000001' AND event IN ('started','owner_proved','provisioned')$q$, 3);
SELECT pg_temp.expect_count('onboarding B has started, owner_proved, failed, resumed, failed and rolled_back events',
  $q$SELECT 1 FROM titan.onboarding_events WHERE onboarding_id='b3000000-0000-4000-8000-000000000001'$q$, 6);
SELECT pg_temp.expect_sqlstate('events cannot be updated by the trusted writer',
  $q$UPDATE titan.onboarding_events SET actor_subject='tampered'$q$, '42501');
SELECT pg_temp.expect_sqlstate('events cannot be deleted by the trusted writer',
  $q$DELETE FROM titan.onboarding_events$q$, '42501');
SELECT pg_temp.expect_sqlstate('onboarding rows cannot be deleted by the trusted writer',
  $q$DELETE FROM titan.onboardings$q$, '42501');
RESET ROLE;

-- Events are append-only even for the owner role, enforced by trigger.
SELECT pg_temp.expect_sqlstate('events cannot be updated by the owner',
  $q$UPDATE titan.onboarding_events SET actor_subject='tampered'$q$, '23514');

-- A write with no actor is refused, even though the row itself is valid.
DO $$
BEGIN
  PERFORM set_config('titan.actor_subject', '', true);
  INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
  VALUES ('c3000000-0000-4000-8000-000000000001','onboarding-key-n-001','c1000000-0000-4000-8000-000000000009','logto_org_n','owner_n','No Actor',ARRAY['desk'],repeat('a',64),'pending');
  RAISE EXCEPTION 'FAIL: write without an actor was accepted';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok: write without an actor rejected';
END $$;

-- ---- Tenant and reader isolation ----
SELECT set_config('titan.organisation_id', 'a1000000-0000-4000-8000-000000000001', true);
SET ROLE titan_tenant_app;
SELECT pg_temp.expect_count('tenant sees only its own onboarding',
  $q$SELECT id FROM titan.onboardings$q$, 1);
SELECT pg_temp.expect_count('tenant sees no onboarding of another organisation',
  $q$SELECT id FROM titan.onboardings WHERE organisation_id='b1000000-0000-4000-8000-000000000001'$q$, 0);
SELECT pg_temp.expect_count('tenant sees only its own product results',
  $q$SELECT 1 FROM titan.onboarding_product_results$q$, 2);
SELECT pg_temp.expect_count('tenant sees no product results of another organisation',
  $q$SELECT 1 FROM titan.onboarding_product_results WHERE organisation_id='b1000000-0000-4000-8000-000000000001'$q$, 0);
SELECT pg_temp.expect_count('tenant sees only its own audit events',
  $q$SELECT 1 FROM titan.onboarding_events$q$, 3);
SELECT pg_temp.expect_sqlstate('tenant cannot create an onboarding',
  $q$INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state)
     VALUES ('d3000000-0000-4000-8000-000000000001','onboarding-key-t-001','a1000000-0000-4000-8000-000000000001','logto_org_t','owner_t','Tenant Write',ARRAY['desk'],repeat('a',64),'pending')$q$, '42501');
SELECT pg_temp.expect_sqlstate('tenant cannot advance an onboarding',
  $q$UPDATE titan.onboardings SET state='failed', failure_code='core_provisioning_failed' WHERE id='a3000000-0000-4000-8000-000000000001'$q$, '42501');
SELECT pg_temp.expect_sqlstate('tenant cannot change product results',
  $q$UPDATE titan.onboarding_product_results SET attempts=9$q$, '42501');
RESET ROLE;

-- Fail closed: an unset or empty tenant scope reads nothing.
SELECT set_config('titan.organisation_id', '', true);
SET ROLE titan_tenant_app;
SELECT pg_temp.expect_count('unset tenant scope reads no onboarding', $q$SELECT id FROM titan.onboardings$q$, 0);
RESET ROLE;

SELECT set_config('titan.organisation_id', '', true);
SET ROLE titan_trusted_reader;
SELECT pg_temp.expect_count('trusted reader sees both onboardings', $q$SELECT id FROM titan.onboardings$q$, 2);
SELECT pg_temp.expect_sqlstate('trusted reader cannot write an onboarding',
  $q$UPDATE titan.onboardings SET state='failed', failure_code='core_provisioning_failed'$q$, '42501');
RESET ROLE;

\echo onboarding SQL checks passed
ROLLBACK;
