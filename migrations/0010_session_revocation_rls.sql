-- Row-level security for titan.titan_session_revocations (the session generation counter).
-- Applied after 0009; 0001 to 0009 are not edited.
--
-- Key: organisation_id. The column is text (it holds the Titan organisation uuid as text, written
-- by provisioning.ts and read by session-revocation-pg.mjs), so the policies compare it with the
-- uuid scope cast to text:  organisation_id = titan.current_organisation_id()::text
-- Scope is the transaction-local setting titan.organisation_id (migration 0006). With no scope the
-- comparison is NULL and no row is visible (fail closed). A malformed scope raises an error in the
-- uuid cast (fail closed), as it does for the other tenant tables.
--
-- Policies, one per role, each with its reason:
--
-- titan_tenant_app       FOR ALL, keyed by the tenant scope. Deliberately NO table grant is given:
--                        a browser-facing role never reads or writes revocations. The policy only
--                        makes any future grant tenant-scoped instead of open.
--
-- titan_trusted_reader   FOR SELECT, keyed by the tenant scope. session-revocation-pg.mjs readVersion
--                        sets the scope for its own transaction to the organisation it checks, so it
--                        reads exactly that organisation's generation. No INSERT, UPDATE or DELETE
--                        policy: the reader has no write grant, so none is needed.
--
-- titan_trusted_writer   Three policies, because the bump is INSERT ... ON CONFLICT DO UPDATE ...
--                        RETURNING generation, which needs INSERT, UPDATE and SELECT. Provisioning is
--                        cross-tenant by design and separately authorised (CentralProvisioner, one audit
--                        row per command), so the writer is not keyed by scope. The writer keeps the
--                        grants from 0007 and 0008 (INSERT, UPDATE, SELECT). It gets no DELETE.
--
-- Login state (titan.titan_oidc_login_states) is NOT tenant-keyed and is NOT covered here, on purpose:
--   * a login row is written at /login, before the Logto callback, so no Titan organisation is known
--     when the row is created and there is no tenant to key it by;
--   * the table has no organisation_id column, and the callback is not yet bound to an organisation;
--   * its access is limited by role (titan_trusted_writer only, grants in 0007 and 0009), by key
--     (application_id, SHA-256 state digest), and by a 10-minute expiry that consume and prune enforce.
-- Changing that would need an organisation column the login flow cannot fill. That is a design decision,
-- not an oversight.
--
-- Superusers and BYPASSRLS roles bypass RLS; the login role (titan_central_app) is NOSUPERUSER and
-- NOBYPASSRLS. FORCE ROW LEVEL SECURITY also applies the policies to the table owner.
BEGIN;

ALTER TABLE titan.titan_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.titan_session_revocations FORCE ROW LEVEL SECURITY;

CREATE POLICY session_revocations_tenant ON titan.titan_session_revocations FOR ALL TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id()::text)
  WITH CHECK (organisation_id = titan.current_organisation_id()::text);

CREATE POLICY session_revocations_trusted_read ON titan.titan_session_revocations FOR SELECT TO titan_trusted_reader
  USING (organisation_id = titan.current_organisation_id()::text);

CREATE POLICY session_revocations_trusted_insert ON titan.titan_session_revocations FOR INSERT TO titan_trusted_writer
  WITH CHECK (true);
CREATE POLICY session_revocations_trusted_update ON titan.titan_session_revocations FOR UPDATE TO titan_trusted_writer
  USING (true) WITH CHECK (true);
CREATE POLICY session_revocations_trusted_select ON titan.titan_session_revocations FOR SELECT TO titan_trusted_writer
  USING (true);

COMMIT;
