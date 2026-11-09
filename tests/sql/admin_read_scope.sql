-- Tenant scoping for the operator access read and the tenant-administration lookups (apps/control-api admin route,
-- packages/control-plane/src/administration.ts). Requires migrations 0001-0009 and 0014 applied, in order.
-- Run as a superuser:  psql -v ON_ERROR_STOP=1 -f tests/sql/admin_read_scope.sql "$DATABASE_URL"
-- Seeds two organisations as the superuser (bypasses RLS), then runs every check as titan_trusted_reader with the
-- organisation scope set exactly as withTenantReadScope does. Any unexpected row count or a permitted write raises
-- an exception and psql exits non-zero. Everything is rolled back at the end.
-- The statements below are copied verbatim from administration.ts; the run log records that they still match.
\set ON_ERROR_STOP on
BEGIN;

-- Parameters are bound with the column types the application sends (organisation IDs are uuid; subjects are text).
CREATE FUNCTION pg_temp.expect_rows(label text, query text, org uuid, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n USING org;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE FUNCTION pg_temp.expect_actor(label text, query text, subject text, org uuid, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n USING subject, org;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE FUNCTION pg_temp.expect_count(label text, sql text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE sql INTO n;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL %: expected %, saw %', label, expected, n; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE FUNCTION pg_temp.expect_denied(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL %: write was permitted', label;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok: %', label;
END $$;

-- Fixed identifiers.
\set orgA '\'aaaaaaaa-0000-4000-8000-00000000000a\''
\set orgB '\'bbbbbbbb-0000-4000-8000-00000000000b\''
\set idAadmin '\'10000000-0000-4000-8000-000000000001\''
\set idAmember '\'10000000-0000-4000-8000-000000000002\''
\set idBadmin '\'10000000-0000-4000-8000-000000000003\''
\set mA1 '\'20000000-0000-4000-8000-000000000001\''
\set mA2 '\'20000000-0000-4000-8000-000000000002\''
\set mB1 '\'20000000-0000-4000-8000-000000000003\''

INSERT INTO titan.identities (id, logto_subject, state) VALUES
 (:idAadmin, 'usr_a_admin', 'active'), (:idAmember, 'usr_a_member', 'active'), (:idBadmin, 'usr_b_admin', 'active');
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES (:orgA, 'org_a', 'active'), (:orgB, 'org_b', 'active');
INSERT INTO titan.memberships (id, identity_id, organisation_id, role, state, revision) VALUES
 (:mA1, :idAadmin, :orgA, 'admin', 'active', 1), (:mA2, :idAmember, :orgA, 'member', 'active', 1), (:mB1, :idBadmin, :orgB, 'owner', 'active', 1);
INSERT INTO titan.entitlements (id, organisation_id, application_id, state, features, revision) VALUES
 ('30000000-0000-4000-8000-000000000001', :orgA, 'desk', 'active', ARRAY['read'], 1),
 ('30000000-0000-4000-8000-000000000002', :orgB, 'desk', 'active', ARRAY['read'], 1);
INSERT INTO titan.local_account_links (id, identity_id, organisation_id, application_id, local_user_id, local_account_id, state, verified_at, revision) VALUES
 ('40000000-0000-4000-8000-000000000001', :idAadmin, :orgA, 'desk', 'lu-a', 'la-a', 'verified', now(), 1),
 ('40000000-0000-4000-8000-000000000002', :idBadmin, :orgB, 'desk', 'lu-b', 'lb-b', 'verified', now(), 1);

SET LOCAL ROLE titan_trusted_reader;

-- Scope = organisation A (what withTenantReadScope sets for a request about A).
SELECT set_config('titan.organisation_id', 'aaaaaaaa-0000-4000-8000-00000000000a', true);

SELECT pg_temp.expect_rows('A scope: membership list (access read) returns A rows only',
 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.expires_at, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.organisation_id=$1 ORDER BY i.logto_subject, m.id',
 'aaaaaaaa-0000-4000-8000-00000000000a', 2);
SELECT pg_temp.expect_rows('A scope: entitlement list returns A rows only',
 'SELECT id, application_id, state, features, expires_at, revision FROM titan.entitlements WHERE organisation_id=$1 ORDER BY application_id, id',
 'aaaaaaaa-0000-4000-8000-00000000000a', 1);
SELECT pg_temp.expect_rows('A scope: link list returns A rows only',
 'SELECT id, identity_id, application_id, local_user_id, local_account_id, state, verified_at, revision FROM titan.local_account_links WHERE organisation_id=$1 ORDER BY application_id, id',
 'aaaaaaaa-0000-4000-8000-00000000000a', 1);
SELECT pg_temp.expect_count('A scope: B membership is invisible even without the predicate (RLS alone)',
 'SELECT count(*) FROM titan.memberships WHERE id=''20000000-0000-4000-8000-000000000003''', 0);
SELECT pg_temp.expect_count('A scope: unfiltered membership read sees only A (RLS alone)',
 'SELECT count(*) FROM titan.memberships', 2);
SELECT pg_temp.expect_count('A scope: unfiltered link read sees only A (RLS alone)',
 'SELECT count(*) FROM titan.local_account_links', 1);
SELECT pg_temp.expect_actor('A scope: actor lookup for an A administrator finds one membership',
 'SELECT m.id, m.identity_id, m.role FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject=$1 AND i.state=''active'' AND m.organisation_id=$2 AND m.state=''active'' AND (m.expires_at IS NULL OR m.expires_at>now())',
 'usr_a_admin', 'aaaaaaaa-0000-4000-8000-00000000000a', 1);
SELECT pg_temp.expect_actor('A scope: a B administrator subject is not an actor in A',
 'SELECT m.id, m.identity_id, m.role FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject=$1 AND i.state=''active'' AND m.organisation_id=$2 AND m.state=''active'' AND (m.expires_at IS NULL OR m.expires_at>now())',
 'usr_b_admin', 'aaaaaaaa-0000-4000-8000-00000000000a', 0);
SELECT pg_temp.expect_count('A scope: B administrator is not an actor in A',
 'SELECT count(*) FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject=''usr_b_admin'' AND m.organisation_id=''aaaaaaaa-0000-4000-8000-00000000000a''', 0);
SELECT pg_temp.expect_count('A scope: target lookup of a B membership id through A is empty',
 'SELECT count(*) FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=''20000000-0000-4000-8000-000000000003'' AND m.organisation_id=''aaaaaaaa-0000-4000-8000-00000000000a''', 0);
CREATE FUNCTION pg_temp.expect_two_uuid(label text, query text, a uuid, b uuid, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n USING a, b;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;
SELECT pg_temp.expect_rows('A scope: organisation lookup by the scoped ID returns that organisation',
 'SELECT id, logto_organisation_id, state FROM titan.organisations WHERE id=$1',
 'aaaaaaaa-0000-4000-8000-00000000000a', 1);
SELECT pg_temp.expect_two_uuid('A scope: target lookup of an A membership id inside A finds it',
 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=$1 AND m.organisation_id=$2',
 '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 1);
SELECT pg_temp.expect_two_uuid('A scope: target lookup of a B membership id through A is empty',
 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=$1 AND m.organisation_id=$2',
 '20000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-00000000000a', 0);
SELECT pg_temp.expect_denied('A scope: the reader cannot update memberships',
 'UPDATE titan.memberships SET state=''suspended'' WHERE id=''20000000-0000-4000-8000-000000000001''');
SELECT pg_temp.expect_denied('A scope: the reader cannot insert identities',
 'INSERT INTO titan.identities (id, logto_subject, state) VALUES (''10000000-0000-4000-8000-0000000000ff'', ''usr_new'', ''active'')');

-- Scope = organisation B.
SELECT set_config('titan.organisation_id', 'bbbbbbbb-0000-4000-8000-00000000000b', true);
SELECT pg_temp.expect_rows('B scope: membership list returns B rows only',
 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.expires_at, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.organisation_id=$1 ORDER BY i.logto_subject, m.id',
 'bbbbbbbb-0000-4000-8000-00000000000b', 1);
SELECT pg_temp.expect_count('B scope: A rows are invisible to an unfiltered read',
 'SELECT count(*) FROM titan.memberships WHERE organisation_id=''aaaaaaaa-0000-4000-8000-00000000000a''', 0);
SELECT pg_temp.expect_count('B scope: the A administrator is not an actor in B',
 'SELECT count(*) FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject=''usr_a_admin'' AND m.organisation_id=''bbbbbbbb-0000-4000-8000-00000000000b''', 0);

-- No scope: fail closed. An empty setting yields no tenant rows.
SELECT set_config('titan.organisation_id', '', true);
SELECT pg_temp.expect_count('no scope: membership read returns nothing', 'SELECT count(*) FROM titan.memberships', 0);
SELECT pg_temp.expect_count('no scope: link read returns nothing', 'SELECT count(*) FROM titan.local_account_links', 0);

ROLLBACK;
\echo 'admin_read_scope.sql: all checks passed'
