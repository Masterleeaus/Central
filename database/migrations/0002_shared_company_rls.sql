-- Shared canonical company core: fail-closed read isolation, separate from
-- the legacy Central migration chain. Scoped reader sees only rows from
-- titan.company_id in its transaction; absent scope returns no company data.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_shared_company_reader') THEN
   CREATE ROLE titan_shared_company_reader NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE FUNCTION titan.current_company_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
 SELECT CASE WHEN current_setting('titan.company_id',true) ~*
 '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN current_setting('titan.company_id',true)::uuid ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION titan.current_company_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_shared_company_reader;
GRANT EXECUTE ON FUNCTION titan.current_company_id() TO titan_shared_company_reader;
GRANT SELECT ON titan.companies,titan.identities,
 titan.company_memberships,titan.application_entitlements,
 titan.application_company_links,titan.application_user_links
 TO titan_shared_company_reader;
-- The global identities table is not a tenant-authority source; a shared
-- reader only sees identities with active membership in the chosen company.
ALTER TABLE titan.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_company_read ON titan.companies FOR SELECT
 TO titan_shared_company_reader USING(id=titan.current_company_id());
ALTER TABLE titan.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.identities FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_identity_member_read ON titan.identities FOR SELECT
 TO titan_shared_company_reader USING(
   EXISTS(SELECT 1 FROM titan.company_memberships AS cm
          WHERE cm.identity_id=id AND cm.company_id=titan.current_company_id())
 );
ALTER TABLE titan.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.company_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_membership_read ON titan.company_memberships FOR SELECT
 TO titan_shared_company_reader USING(company_id=titan.current_company_id());
ALTER TABLE titan.application_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.application_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_entitlement_read ON titan.application_entitlements FOR SELECT
 TO titan_shared_company_reader USING(company_id=titan.current_company_id());
ALTER TABLE titan.application_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.application_company_links FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_company_links_read ON titan.application_company_links FOR SELECT
 TO titan_shared_company_reader USING(company_id=titan.current_company_id());
ALTER TABLE titan.application_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.application_user_links FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_user_links_read ON titan.application_user_links FOR SELECT
 TO titan_shared_company_reader USING(company_id=titan.current_company_id());
COMMIT;
