-- Two-organisation row-level security test for titan.titan_session_revocations (migration 0010).
-- Run as a superuser against a database where migrations 0001-0010 are applied, and with no rows in
-- titan.titan_session_revocations:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/session_revocation_rls.sql "$DATABASE_URL"
--
-- Each step runs as the role the Node code uses:
--   * the login role titan_central_app (NOSUPERUSER, NOBYPASSRLS, NOINHERIT), via SESSION AUTHORIZATION,
--   * then SET LOCAL ROLE titan_trusted_reader (readVersion) or titan_trusted_writer (revokeAll),
--   * and titan_tenant_app, which is checked as the superuser because the login role is not a member of it.
-- Everything after the seed runs in one transaction that is rolled back, so the database is unchanged.
-- Any allowed operation that fails, or any denied operation that succeeds, raises and psql exits non-zero.
\set ON_ERROR_STOP on

-- The login role is created outside the transaction (as migration-time bootstrap does) and kept.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_central_app') THEN
    CREATE ROLE titan_central_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE titan_central_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT titan_trusted_reader, titan_trusted_writer TO titan_central_app;

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

CREATE FUNCTION pg_temp.expect_affected(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s) affected, saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- A write must be refused by privilege or policy, or affect zero rows.
CREATE FUNCTION pg_temp.expect_denied(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE NOTICE 'ok (no rows affected): %', label;
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL denied write succeeded: % (% row(s))', label, n;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'ok (denied): %', label;
END $$;

-- A statement must raise an error (missing grant, malformed scope).
CREATE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL expected an error: %', label;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL expected an error%' THEN RAISE; END IF;
    RAISE NOTICE 'ok (error): %', label;
END $$;

-- ---------------------------------------------------------------- preconditions (superuser)
DO $$
BEGIN
  IF (SELECT count(*) FROM titan.titan_session_revocations) <> 0 THEN
    RAISE EXCEPTION 'precondition: titan.titan_session_revocations must be empty';
  END IF;
END $$;

SELECT pg_temp.expect_count('login role is not a superuser and does not bypass RLS, and does not inherit',
  $s$SELECT 1 FROM pg_roles WHERE rolname = 'titan_central_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit$s$, 1);
SELECT pg_temp.expect_count('login role is a member of both trusted roles',
  $s$SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
     WHERE u.rolname = 'titan_central_app' AND r.rolname IN ('titan_trusted_reader', 'titan_trusted_writer')$s$, 2);
SELECT pg_temp.expect_count('RLS is enabled and forced on session revocations',
  $s$SELECT 1 FROM pg_class WHERE oid = 'titan.titan_session_revocations'::regclass AND relrowsecurity AND relforcerowsecurity$s$, 1);
SELECT pg_temp.expect_count('session revocations have the five 0010 policies',
  $s$SELECT 1 FROM (SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'titan' AND tablename = 'titan_session_revocations') c WHERE c.n = 5$s$, 1);

-- ---------------------------------------------------------------- seed (superuser bypasses RLS for seeding)
-- Organisation identifiers are the Titan organisation uuids as text, as provisioning writes them.
INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES
  ('desk', 'rls-sub-a', '00000000-0000-4000-8000-00000000000a', 2),
  ('desk', 'rls-sub-b', '00000000-0000-4000-8000-00000000000b', 5);

-- ---------------------------------------------------------------- login role path (as titan_central_app)
SET SESSION AUTHORIZATION titan_central_app;

-- readVersion: SET LOCAL ROLE titan_trusted_reader, scope set to organisation A.
SET LOCAL ROLE titan_trusted_reader;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT pg_temp.expect_count('reader in org A sees only org A revocation rows', 'SELECT application_id FROM titan.titan_session_revocations', 1);
SELECT pg_temp.expect_count('reader in org A reads its own generation (2)',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE application_id = 'desk' AND logto_subject = 'rls-sub-a' AND organisation_id = '00000000-0000-4000-8000-00000000000a' AND generation = 2$s$, 1);
SELECT pg_temp.expect_count('second organisation revocation row is invisible to org A reader',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE application_id = 'desk' AND logto_subject = 'rls-sub-b' AND organisation_id = '00000000-0000-4000-8000-00000000000b'$s$, 0);
SELECT pg_temp.expect_denied('reader cannot bump a generation',
  $s$UPDATE titan.titan_session_revocations SET generation = generation + 1$s$);
SELECT pg_temp.expect_error('reader has no insert grant on session revocations',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'rls-sub-c', '00000000-0000-4000-8000-00000000000a', 1)$s$);

-- Switching the scope to organisation B: the B row is visible, the A row is not.
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-00000000000b', true);
SELECT pg_temp.expect_count('reader in org B sees only org B revocation rows', 'SELECT application_id FROM titan.titan_session_revocations', 1);
SELECT pg_temp.expect_count('org B reader cannot see org A row by key',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE logto_subject = 'rls-sub-a'$s$, 0);

-- No organisation context: no rows, and a malformed context raises (fail closed).
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('reader with no context sees no revocation rows', 'SELECT application_id FROM titan.titan_session_revocations', 0);
SELECT set_config('titan.organisation_id', 'not-a-uuid', true);
SELECT pg_temp.expect_error('reader fails closed on a malformed context', 'SELECT generation FROM titan.titan_session_revocations');
RESET ROLE;

-- revokeAll: SET LOCAL ROLE titan_trusted_writer, no scope (cross-tenant by design).
SET LOCAL ROLE titan_trusted_writer;
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('writer sees all organisations revocation rows', 'SELECT application_id FROM titan.titan_session_revocations', 2);
SELECT pg_temp.expect_affected('writer bumps org A generation (conflict path)',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'rls-sub-a', '00000000-0000-4000-8000-00000000000a', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now()$s$, 1);
SELECT pg_temp.expect_count('writer advanced org A generation to 3',
  $s$SELECT generation FROM titan.titan_session_revocations WHERE logto_subject = 'rls-sub-a' AND generation = 3$s$, 1);
SELECT pg_temp.expect_affected('writer bumps org B generation (conflict path, cross-tenant)',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('desk', 'rls-sub-b', '00000000-0000-4000-8000-00000000000b', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now() RETURNING generation$s$, 1);
SELECT pg_temp.expect_affected('writer inserts a first revocation for a new organisation (insert path)',
  $s$INSERT INTO titan.titan_session_revocations (application_id, logto_subject, organisation_id, generation) VALUES ('field', 'rls-sub-c', '00000000-0000-4000-8000-00000000000c', 1) ON CONFLICT (application_id, logto_subject, organisation_id) DO UPDATE SET generation = titan.titan_session_revocations.generation + 1, revoked_at = now()$s$, 1);
SELECT pg_temp.expect_denied('writer cannot delete a revocation row',
  $s$DELETE FROM titan.titan_session_revocations WHERE logto_subject = 'rls-sub-c'$s$);
RESET ROLE;

-- The login role has no privilege of its own on the table.
SELECT pg_temp.expect_error('login role without a role switch cannot read session revocations',
  $s$SELECT generation FROM titan.titan_session_revocations$s$);
RESET SESSION AUTHORIZATION;

-- ---------------------------------------------------------------- tenant app (checked as superuser)
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT pg_temp.expect_error('tenant app has no grant on session revocations', 'SELECT generation FROM titan.titan_session_revocations');
RESET ROLE;

-- ---------------------------------------------------------------- state after the checks (superuser, bypasses RLS)
SELECT pg_temp.expect_count('org A generation is 3 after the bump', $s$SELECT generation FROM titan.titan_session_revocations WHERE logto_subject = 'rls-sub-a'$s$, 1);
SELECT pg_temp.expect_count('org B row untouched by the reader checks (generation 6 after one bump)', $s$SELECT generation FROM titan.titan_session_revocations WHERE logto_subject = 'rls-sub-b' AND generation = 6$s$, 1);

ROLLBACK;
\echo Session revocation RLS tests passed
