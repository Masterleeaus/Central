-- Narrows the trusted reader and fixes a provisioning grant gap left by 0006 and 0007.
-- Applied after 0006 and 0007; 0006 and 0007 are not edited.
--
-- 1. titan_trusted_reader was granted USING (true) on memberships, entitlements and
--    local_account_links. The access check always reads one organisation, so the reader is
--    now scoped to the organisation set for the transaction with
--        SELECT set_config('titan.organisation_id', $1, true);   -- same effect as SET LOCAL
--    With no organisation set, the reader sees no tenant rows (fail closed). The reader still
--    reads titan.identities and titan.organisations, which are global and not RLS-protected.
--    titan_trusted_writer keeps cross-tenant access: provisioning is cross-tenant by design and
--    is separately authorised (CentralProvisioner, with an audit row per command).
--
-- 2. Provisioning bumps titan.titan_session_revocations with INSERT ... ON CONFLICT DO UPDATE
--    ... RETURNING generation. PostgreSQL requires SELECT for that statement, which 0007 did not
--    grant to titan_trusted_writer. Without it every revoking command fails with permission denied.
--
-- Not covered here (still outstanding, see README): titan.titan_session_revocations has no RLS,
-- and titan.titan_oidc_login_states has no SELECT for titan_trusted_writer.
BEGIN;

DROP POLICY IF EXISTS memberships_trusted_read ON titan.memberships;
CREATE POLICY memberships_trusted_read ON titan.memberships FOR SELECT TO titan_trusted_reader
  USING (organisation_id = titan.current_organisation_id());

DROP POLICY IF EXISTS entitlements_trusted_read ON titan.entitlements;
CREATE POLICY entitlements_trusted_read ON titan.entitlements FOR SELECT TO titan_trusted_reader
  USING (organisation_id = titan.current_organisation_id());

DROP POLICY IF EXISTS local_account_links_trusted_read ON titan.local_account_links;
CREATE POLICY local_account_links_trusted_read ON titan.local_account_links FOR SELECT TO titan_trusted_reader
  USING (organisation_id = titan.current_organisation_id());

GRANT SELECT ON titan.titan_session_revocations TO titan_trusted_writer;

COMMIT;
