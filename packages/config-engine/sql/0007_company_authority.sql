-- Draft company authority role, dependent on canonical company schema under #43.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_company_authority_reader') THEN
 CREATE ROLE titan_config_company_authority_reader NOLOGIN NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA titan TO titan_config_company_authority_reader;
GRANT SELECT(id,status) ON titan.companies TO titan_config_company_authority_reader;
GRANT SELECT(id,logto_subject,status) ON titan.identities TO titan_config_company_authority_reader;
GRANT SELECT(company_id,identity_id,role,status,expires_at)
 ON titan.company_memberships TO titan_config_company_authority_reader;
GRANT SELECT(company_id,application_id,status,expires_at)
 ON titan.application_entitlements TO titan_config_company_authority_reader;
COMMIT;
