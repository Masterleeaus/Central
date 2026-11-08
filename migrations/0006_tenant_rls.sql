-- REVIEW BEFORE APPLYING. Titan Central database ONLY. Unverified against a live
-- database until tests/sql/rls_two_tenant.sql passes in CI.
--
-- Tenant isolation for titan.memberships, titan.entitlements and
-- titan.local_account_links. Tenant scope is the transaction-local setting
-- titan.organisation_id, which the application must set before any tenant query:
--   SET LOCAL titan.organisation_id = '<organisation uuid>';
-- If the setting is missing or empty, no rows are visible and no writes succeed
-- (fail closed). A malformed value raises an error (also fail closed).
--
-- Roles (NOLOGIN group roles; grant them to login roles per deployment):
--   titan_tenant_app      tenant-scoped SELECT/INSERT/UPDATE/DELETE on the three tables.
--   titan_trusted_reader  cross-tenant SELECT on the three tables, plus identities and
--                         organisations, for the server-side access check.
--   titan_trusted_writer  cross-tenant writes for server-side provisioning, which must be
--                         independently authorised. Never granted to a browser-facing role.
--
-- titan.identities and titan.organisations are deliberately global (an identity spans
-- organisations) and are not RLS-protected; only the trusted reader can query them.
-- Superusers and BYPASSRLS roles bypass RLS; the application must not connect as them.
-- FORCE ROW LEVEL SECURITY makes the table owner subject to the policies as well.
--
-- titan.provisioning_audit and titan.titan_session_revocations are NOT covered by this
-- migration; cross-tenant session-revocation protection is still outstanding.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_tenant_app') THEN
    CREATE ROLE titan_tenant_app NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_trusted_reader') THEN
    CREATE ROLE titan_trusted_reader NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_trusted_writer') THEN
    CREATE ROLE titan_trusted_writer NOLOGIN NOINHERIT;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION titan.current_organisation_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('titan.organisation_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA titan TO titan_tenant_app, titan_trusted_reader, titan_trusted_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON titan.memberships, titan.entitlements, titan.local_account_links TO titan_tenant_app;
GRANT SELECT ON titan.identities, titan.organisations, titan.memberships, titan.entitlements, titan.local_account_links TO titan_trusted_reader;
GRANT SELECT, INSERT, UPDATE ON titan.identities, titan.organisations, titan.memberships, titan.entitlements, titan.local_account_links TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.provisioning_audit TO titan_trusted_writer;

ALTER TABLE titan.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant ON titan.memberships FOR ALL TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id())
  WITH CHECK (organisation_id = titan.current_organisation_id());
CREATE POLICY memberships_trusted_read ON titan.memberships FOR SELECT TO titan_trusted_reader
  USING (true);
CREATE POLICY memberships_trusted_write ON titan.memberships FOR ALL TO titan_trusted_writer
  USING (true) WITH CHECK (true);

ALTER TABLE titan.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY entitlements_tenant ON titan.entitlements FOR ALL TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id())
  WITH CHECK (organisation_id = titan.current_organisation_id());
CREATE POLICY entitlements_trusted_read ON titan.entitlements FOR SELECT TO titan_trusted_reader
  USING (true);
CREATE POLICY entitlements_trusted_write ON titan.entitlements FOR ALL TO titan_trusted_writer
  USING (true) WITH CHECK (true);

ALTER TABLE titan.local_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.local_account_links FORCE ROW LEVEL SECURITY;
CREATE POLICY local_account_links_tenant ON titan.local_account_links FOR ALL TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id())
  WITH CHECK (organisation_id = titan.current_organisation_id());
CREATE POLICY local_account_links_trusted_read ON titan.local_account_links FOR SELECT TO titan_trusted_reader
  USING (true);
CREATE POLICY local_account_links_trusted_write ON titan.local_account_links FOR ALL TO titan_trusted_writer
  USING (true) WITH CHECK (true);
COMMIT;
