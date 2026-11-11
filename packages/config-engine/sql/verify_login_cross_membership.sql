\set ON_ERROR_STOP on
DO $$
BEGIN
 IF pg_has_role('titan_config_api_login','titan_config_grant_reader','MEMBER')
 OR pg_has_role('titan_config_api_login','titan_config_company_authority_reader','MEMBER')
 OR pg_has_role('titan_config_grants_login','titan_config_company_authority_reader','MEMBER')
 OR pg_has_role('titan_config_grant_admin_login','titan_config_reader','MEMBER')
 THEN RAISE EXCEPTION 'unexpected cross-service membership';END IF;
END $$;
