\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT pg_has_role('titan_config_api_login','titan_config_reader','MEMBER')
 OR NOT pg_has_role('titan_config_grants_login','titan_config_grant_reader','MEMBER')
 OR NOT pg_has_role('titan_config_grant_admin_login','titan_config_grant_writer','MEMBER')
 OR NOT pg_has_role('titan_config_authority_login','titan_config_company_authority_reader','MEMBER')
 THEN RAISE EXCEPTION 'missing service role membership';END IF;
 IF pg_has_role('titan_config_api_login','titan_config_grant_writer','MEMBER')
 OR pg_has_role('titan_config_grants_login','titan_config_reader','MEMBER')
 OR pg_has_role('titan_config_authority_login','titan_config_grant_writer','MEMBER')
 THEN RAISE EXCEPTION 'service login can SET ROLE across boundaries';END IF;
END $$;
