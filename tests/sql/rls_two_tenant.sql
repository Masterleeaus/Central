-- Two-tenant row-level security test for migration 0006.
-- Run as a superuser against a database where migrations 0001-0006 are applied:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/rls_two_tenant.sql "$DATABASE_URL"
-- The script seeds two tenants (the superuser bypasses RLS for seeding), then switches to the
-- tenant and trusted roles and asserts what each may see and change. Any cross-tenant row
-- visible, or any cross-tenant write that succeeds, raises an exception and psql exits non-zero.
-- Everything runs inside one transaction that is rolled back at the end.
\set ON_ERROR_STOP on
BEGIN;

-- Helper: the rows visible to the current role must equal expected.
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

-- Helper: a write must affect exactly expected rows (0 for a cross-tenant attempt).
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

-- Helper: a write must be refused by privilege or RLS (error), or affect zero rows.
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
  RAISE EXCEPTION 'FAIL cross-tenant write succeeded: % (% row(s))', label, n;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'ok (denied): %', label;
END $$;

-- Helper: a read must raise an error (used for malformed or missing grants).
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

-- ---------------------------------------------------------------- tenant A
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT pg_temp.expect_count('tenant A reads own memberships', 'SELECT id FROM titan.memberships', 1);
SELECT pg_temp.expect_count('tenant A reads own entitlements', 'SELECT id FROM titan.entitlements', 1);
SELECT pg_temp.expect_count('tenant A reads own account links', 'SELECT id FROM titan.local_account_links', 1);
SELECT pg_temp.expect_count('tenant A cannot read tenant B memberships by id', $s$SELECT id FROM titan.memberships WHERE id = '00000000-0000-4000-8000-000000000c02'$s$, 0);
SELECT pg_temp.expect_count('tenant A cannot read tenant B entitlements by id', $s$SELECT id FROM titan.entitlements WHERE id = '00000000-0000-4000-8000-000000000e02'$s$, 0);
SELECT pg_temp.expect_count('tenant A cannot read tenant B account links by id', $s$SELECT id FROM titan.local_account_links WHERE id = '00000000-0000-4000-8000-000000000d02'$s$, 0);
SELECT pg_temp.expect_affected('tenant A own membership update is allowed', $s$UPDATE titan.memberships SET revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000c01'$s$, 1);
SELECT pg_temp.expect_denied('tenant A cannot role-change tenant B membership', $s$UPDATE titan.memberships SET state = 'suspended', revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000c02'$s$);
SELECT pg_temp.expect_denied('tenant A cannot revoke tenant B account link', $s$UPDATE titan.local_account_links SET state = 'revoked', revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000d02'$s$);
SELECT pg_temp.expect_denied('tenant A cannot change tenant B entitlement', $s$UPDATE titan.entitlements SET state = 'revoked', revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000e02'$s$);
SELECT pg_temp.expect_denied('tenant A cannot delete tenant B entitlement', $s$DELETE FROM titan.entitlements WHERE id = '00000000-0000-4000-8000-000000000e02'$s$);
SELECT pg_temp.expect_denied('tenant A cannot insert membership into tenant B', $s$INSERT INTO titan.memberships (id, identity_id, organisation_id, role, state) VALUES ('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b', 'admin', 'active')$s$);
SELECT pg_temp.expect_denied('tenant A cannot insert entitlement into tenant B', $s$INSERT INTO titan.entitlements (id, organisation_id, application_id, state) VALUES ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-00000000000b', 'field', 'active')$s$);
SELECT pg_temp.expect_denied('tenant A cannot move own membership into tenant B', $s$UPDATE titan.memberships SET organisation_id = '00000000-0000-4000-8000-00000000000b' WHERE id = '00000000-0000-4000-8000-000000000c01'$s$);
SELECT pg_temp.expect_error('tenant A has no grant on identities', $s$SELECT id FROM titan.identities$s$);
SELECT pg_temp.expect_error('tenant A has no grant on organisations', $s$SELECT id FROM titan.organisations$s$);
RESET ROLE;

-- Tenant B state must be untouched, checked as the superuser.
SELECT pg_temp.expect_count('tenant B membership unchanged', $s$SELECT id FROM titan.memberships WHERE id = '00000000-0000-4000-8000-000000000c02' AND state = 'active' AND revision = 1$s$, 1);
SELECT pg_temp.expect_count('tenant B link unchanged', $s$SELECT id FROM titan.local_account_links WHERE id = '00000000-0000-4000-8000-000000000d02' AND state = 'verified'$s$, 1);
SELECT pg_temp.expect_count('tenant B entitlement unchanged', $s$SELECT id FROM titan.entitlements WHERE id = '00000000-0000-4000-8000-000000000e02' AND state = 'active'$s$, 1);
SELECT pg_temp.expect_count('no membership was added to tenant B', $s$SELECT id FROM titan.memberships WHERE organisation_id = '00000000-0000-4000-8000-00000000000b'$s$, 1);
SELECT pg_temp.expect_count('tenant A membership was not moved', $s$SELECT id FROM titan.memberships WHERE id = '00000000-0000-4000-8000-000000000c01' AND organisation_id = '00000000-0000-4000-8000-00000000000a'$s$, 1);

-- ---------------------------------------------------------------- malformed and unset scope
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id', 'not-a-uuid', true);
SELECT pg_temp.expect_error('malformed organisation setting fails closed', 'SELECT id FROM titan.memberships');
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('unscoped session sees no memberships', 'SELECT id FROM titan.memberships', 0);
SELECT pg_temp.expect_count('unscoped session sees no entitlements', 'SELECT id FROM titan.entitlements', 0);
SELECT pg_temp.expect_count('unscoped session sees no account links', 'SELECT id FROM titan.local_account_links', 0);
SELECT pg_temp.expect_denied('unscoped session cannot insert membership', $s$INSERT INTO titan.memberships (id, identity_id, organisation_id, role, state) VALUES ('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'member', 'active')$s$);
RESET ROLE;

-- ---------------------------------------------------------------- trusted reader (server-side access check path)
SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_count('trusted reader sees identities', 'SELECT id FROM titan.identities', 2);
SELECT pg_temp.expect_count('trusted reader sees organisations', 'SELECT id FROM titan.organisations', 2);
SELECT pg_temp.expect_count('trusted reader sees both tenants memberships', 'SELECT id FROM titan.memberships', 2);
SELECT pg_temp.expect_count('trusted reader sees both tenants entitlements', 'SELECT id FROM titan.entitlements', 2);
SELECT pg_temp.expect_count('trusted reader sees both tenants account links', 'SELECT id FROM titan.local_account_links', 2);
SELECT pg_temp.expect_denied('trusted reader cannot write memberships', $s$UPDATE titan.memberships SET state = 'suspended' WHERE id = '00000000-0000-4000-8000-000000000c02'$s$);
RESET ROLE;

-- ---------------------------------------------------------------- trusted writer (positive control)
SET LOCAL ROLE titan_trusted_writer;
SELECT pg_temp.expect_affected('trusted writer can suspend tenant B membership', $s$UPDATE titan.memberships SET state = 'suspended', revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000c02'$s$, 1);
SELECT pg_temp.expect_affected('trusted writer can restore tenant B membership', $s$UPDATE titan.memberships SET state = 'active', revision = revision + 1 WHERE id = '00000000-0000-4000-8000-000000000c02'$s$, 1);
RESET ROLE;

ROLLBACK;
\echo RLS two-tenant tests passed
