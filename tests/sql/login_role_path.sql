-- Login-role path test for migrations 0001-0009.
-- Covers the statements run by apps/control-api (session-revocation-pg.mjs, oidc-state-pg.mjs) and by
-- the access check (withCentralReadSnapshot), as the service login role titan_central_app.
--
-- Run as a superuser against a database where migrations 0001-0009 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/login_role_path.sql "$DATABASE_URL"
-- or through tests/test_login_role_path.py with TITAN_TEST_DATABASE_URL set.
--
-- The script creates titan_central_app if it is missing (LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS),
-- grants it the two trusted roles, seeds two tenants as the superuser (who bypasses RLS for seeding),
-- then runs SET SESSION AUTHORIZATION titan_central_app. That makes the session's identity the login
-- role, which is what a pooled connection of the service has. Each store operation then switches role
-- with SET LOCAL ROLE, as the Node code does, and RESET ROLE afterwards.
--
-- Everything runs in one transaction that is rolled back at the end, so the database is left unchanged.
-- The row-count checks need empty titan tables: use a freshly migrated database (CI does; locally use a
-- throwaway database). The script refuses to run if any titan table already holds rows.
-- Any allowed operation that fails, or any denied operation that succeeds, raises an exception and
-- psql exits non-zero.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- helpers
-- Rows visible to the current role must equal expected.
CREATE FUNCTION pg_temp.expect_count(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok (allowed): % = %', label, n;
END $$;

-- A write must affect exactly expected rows.
CREATE FUNCTION pg_temp.expect_affected(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s) affected, saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok (allowed): % (% row)', label, n;
END $$;

-- A statement must be refused by privilege or RLS (or affect zero rows).
CREATE FUNCTION pg_temp.expect_denied(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE NOTICE 'ok (denied, 0 rows): %', label;
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL denied statement succeeded: % (% row(s))', label, n;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'ok (denied, %): %', SQLSTATE, label;
END $$;

-- A statement must raise an error (missing grant, malformed scope, or a column not granted).
CREATE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL expected an error: %', label;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL expected an error%' THEN RAISE; END IF;
    RAISE NOTICE 'ok (denied, %: %): %', SQLSTATE, SQLERRM, label;
END $$;

-- ---------------------------------------------------------------- preconditions
-- The checks below count rows, so the tables must be empty. Refuse to run on a database that holds data.
DO $$
DECLARE n bigint := 0;
BEGIN
  SELECT (SELECT count(*) FROM titan.identities) + (SELECT count(*) FROM titan.organisations)
       + (SELECT count(*) FROM titan.memberships) + (SELECT count(*) FROM titan.entitlements)
       + (SELECT count(*) FROM titan.local_account_links) + (SELECT count(*) FROM titan.titan_session_revocations)
       + (SELECT count(*) FROM titan.titan_oidc_login_states) INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL database already holds % row(s) in titan tables; run this script only on a freshly migrated database', n;
  END IF;
END $$;

-- ---------------------------------------------------------------- login role preconditions
-- Asserted as the superuser, before the session becomes the login role.
DO $$
BEGIN
  CREATE ROLE titan_central_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
GRANT titan_trusted_reader, titan_trusted_writer TO titan_central_app;

DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolinherit, rolcanlogin INTO r FROM pg_roles WHERE rolname = 'titan_central_app';
  IF r.rolsuper OR r.rolbypassrls OR r.rolinherit OR NOT r.rolcanlogin THEN
    RAISE EXCEPTION 'FAIL titan_central_app must be LOGIN, NOINHERIT, NOSUPERUSER and NOBYPASSRLS';
  END IF;
  IF NOT (pg_has_role('titan_central_app', 'titan_trusted_reader', 'MEMBER') AND pg_has_role('titan_central_app', 'titan_trusted_writer', 'MEMBER')) THEN
    RAISE EXCEPTION 'FAIL titan_central_app must be a member of both trusted roles';
  END IF;
  RAISE NOTICE 'ok: titan_central_app is LOGIN NOINHERIT, not superuser, not BYPASSRLS, member of both trusted roles';
END $$;

-- ---------------------------------------------------------------- seed (superuser, bypasses RLS)
INSERT INTO titan.identities (id, logto_subject, state) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'sub-alice', 'active'),
  ('00000000-0000-4000-8000-0000000000b1', 'sub-bob', 'active');
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'org-tenant-a', 'active'),
  ('00000000-0000-4000-8000-00000000000b', 'org-tenant-b', 'active');
INSERT INTO titan.memberships (id, identity_id, organisation_id, role, state) VALUES
  ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'owner', 'active'),
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'member', 'active');
INSERT INTO titan.entitlements (id, organisation_id, application_id, state) VALUES
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-00000000000a', 'desk', 'active'),
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-00000000000b', 'desk', 'active');
INSERT INTO titan.local_account_links (id, identity_id, organisation_id, application_id, local_user_id, local_account_id, state, verified_at) VALUES
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'desk', 'u-a', 'acct-a', 'verified', now()),
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'desk', 'u-b', 'acct-b', 'verified', now());

-- ---------------------------------------------------------------- become the login role
SET SESSION AUTHORIZATION titan_central_app;
DO $$
BEGIN
  IF current_user <> 'titan_central_app' OR session_user <> 'titan_central_app' THEN
    RAISE EXCEPTION 'FAIL session is not the login role (current_user=%, session_user=%)', current_user, session_user;
  END IF;
  RAISE NOTICE 'ok: session runs as titan_central_app';
END $$;

-- ---------------------------------------------------------------- A. no role switch: denied
-- The login role has no privileges of its own. These are the statements that failed before 0009
-- and before the stores switched role.
SELECT pg_temp.expect_error('no role switch: cannot read session revocations',
  $s$SELECT generation FROM titan.titan_session_revocations$s$);
SELECT pg_temp.expect_error('no role switch: cannot write session revocations',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'sub-alice', 'org-tenant-a', 1)$s$);
SELECT pg_temp.expect_error('no role switch: cannot read OIDC login states',
  $s$SELECT state_digest FROM titan.titan_oidc_login_states$s$);
SELECT pg_temp.expect_error('no role switch: cannot insert OIDC login state',
  $s$INSERT INTO titan.titan_oidc_login_states (application_id, state_digest, nonce, code_verifier, binding_hash, expires_at) VALUES ('desk', repeat('e', 64), 'n', 'v', 'h', now() + interval '5 minutes')$s$);
SELECT pg_temp.expect_error('no role switch: cannot read memberships',
  $s$SELECT id FROM titan.memberships$s$);

-- ---------------------------------------------------------------- B. session revocation (readVersion, revokeAll)
-- readVersion runs as titan_trusted_reader.
SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_count('reader readVersion with no row returns generation 0 (zero rows)',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE application_id = 'desk' AND logto_subject = 'sub-alice' AND organisation_id = 'org-tenant-a'$s$, 0);
SELECT pg_temp.expect_denied('reader cannot bump a revocation generation',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'sub-alice', 'org-tenant-a', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now()$s$);
SELECT pg_temp.expect_denied('reader cannot update a revocation generation',
  $s$UPDATE titan.titan_session_revocations SET generation = 99$s$);
RESET ROLE;

-- revokeAll runs as titan_trusted_writer: INSERT ... ON CONFLICT DO UPDATE ... RETURNING generation.
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_affected('writer revokeAll creates generation 1',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'sub-alice', 'org-tenant-a', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now() RETURNING generation$s$, 1);
SELECT pg_temp.expect_affected('writer revokeAll bumps the same key to generation 2',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'sub-alice', 'org-tenant-a', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now() RETURNING generation$s$, 1);
RESET ROLE;

SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_count('reader readVersion sees generation 2 after the bump',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE application_id = 'desk' AND logto_subject = 'sub-alice' AND organisation_id = 'org-tenant-a' AND generation = 2$s$, 1);
RESET ROLE;

-- ---------------------------------------------------------------- C. OIDC login state (save, consume, prune)
-- save and consume and prune run as titan_trusted_writer.
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_affected('writer saves a live OIDC state',
  $s$INSERT INTO titan.titan_oidc_login_states (application_id, state_digest, nonce, code_verifier, binding_hash, expires_at) VALUES ('desk', repeat('a', 64), 'sealed-nonce-a', 'sealed-verifier-a', 'binding-a', now() + interval '5 minutes')$s$, 1);
SELECT pg_temp.expect_affected('writer saves an already expired OIDC state (for prune)',
  $s$INSERT INTO titan.titan_oidc_login_states (application_id, state_digest, nonce, code_verifier, binding_hash, expires_at) VALUES ('desk', repeat('b', 64), 'sealed-nonce-b', 'sealed-verifier-b', 'binding-b', now() - interval '1 minute')$s$, 1);
SELECT pg_temp.expect_affected('writer consume deletes a live state once (DELETE ... RETURNING)',
  $s$DELETE FROM titan.titan_oidc_login_states WHERE application_id = 'desk' AND state_digest = repeat('a', 64) AND expires_at > now() RETURNING nonce, code_verifier, binding_hash, expires_at$s$, 1);
SELECT pg_temp.expect_affected('writer second consume of the same state returns nothing',
  $s$DELETE FROM titan.titan_oidc_login_states WHERE application_id = 'desk' AND state_digest = repeat('a', 64) AND expires_at > now() RETURNING nonce, code_verifier, binding_hash, expires_at$s$, 0);
SELECT pg_temp.expect_affected('writer prune deletes expired rows in one batch',
  $s$DELETE FROM titan.titan_oidc_login_states WHERE (application_id, state_digest) IN (SELECT application_id, state_digest FROM titan.titan_oidc_login_states WHERE expires_at <= now() LIMIT 1000)$s$, 1);
SELECT pg_temp.expect_error('writer cannot read created_at (not granted by 0009)',
  $s$SELECT created_at FROM titan.titan_oidc_login_states$s$);
SELECT pg_temp.expect_denied('writer cannot update an OIDC login state',
  $s$UPDATE titan.titan_oidc_login_states SET binding_hash = 'x'$s$);
RESET ROLE;

SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_error('reader cannot read OIDC login states',
  $s$SELECT state_digest FROM titan.titan_oidc_login_states$s$);
SELECT pg_temp.expect_denied('reader cannot insert an OIDC login state',
  $s$INSERT INTO titan.titan_oidc_login_states (application_id, state_digest, nonce, code_verifier, binding_hash, expires_at) VALUES ('desk', repeat('f', 64), 'n', 'v', 'h', now() + interval '5 minutes')$s$);
RESET ROLE;

-- ---------------------------------------------------------------- D. access check (withCentralReadSnapshot)
-- Reader scoped to organisation A, using set_config with a bound value (the Node code's form).
SET LOCAL ROLE titan_trusted_reader;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT pg_temp.expect_count('access check: tenant A reads own membership',
  $s$SELECT id FROM titan.memberships WHERE identity_id = '00000000-0000-4000-8000-0000000000a1'$s$, 1);
SELECT pg_temp.expect_count('access check: tenant A reads own entitlements',
  $s$SELECT id FROM titan.entitlements$s$, 1);
SELECT pg_temp.expect_count('access check: tenant A reads own account links',
  $s$SELECT id FROM titan.local_account_links$s$, 1);
SELECT pg_temp.expect_count('access check: tenant A cannot read tenant B membership',
  $s$SELECT id FROM titan.memberships WHERE id = '00000000-0000-4000-8000-000000000c02'$s$, 0);
SELECT pg_temp.expect_count('access check: tenant A cannot read tenant B link',
  $s$SELECT id FROM titan.local_account_links WHERE id = '00000000-0000-4000-8000-000000000d02'$s$, 0);
SELECT pg_temp.expect_count('access check: identities and organisations are global to the reader',
  $s$SELECT id FROM titan.identities$s$, 2);
SELECT pg_temp.expect_denied('access check: reader cannot change a membership',
  $s$UPDATE titan.memberships SET state = 'suspended' WHERE id = '00000000-0000-4000-8000-000000000c01'$s$);
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('access check: unscoped reader sees no memberships (fail closed)',
  $s$SELECT id FROM titan.memberships$s$, 0);
SELECT set_config('titan.organisation_id', 'not-a-uuid', true);
SELECT pg_temp.expect_error('access check: malformed scope raises an error',
  $s$SELECT id FROM titan.memberships$s$);
SELECT set_config('titan.organisation_id', '', true);
RESET ROLE;

-- Provisioning is cross-tenant by design (titan_trusted_writer keeps its 0006 policy).
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_count('writer provisioning reads both tenants (cross-tenant by design)',
  $s$SELECT id FROM titan.memberships$s$, 2);
RESET ROLE;

-- ---------------------------------------------------------------- E. the login role after all switches
SELECT pg_temp.expect_error('after RESET ROLE the login role again cannot read session revocations',
  $s$SELECT generation FROM titan.titan_session_revocations$s$);

DO $$
BEGIN
  IF current_user <> 'titan_central_app' THEN
    RAISE EXCEPTION 'FAIL role switch was not reset (current_user=%)', current_user;
  END IF;
  RAISE NOTICE 'login-role path: all checks passed';
END $$;

ROLLBACK;
