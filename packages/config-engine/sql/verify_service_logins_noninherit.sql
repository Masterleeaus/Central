\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_api_login','titan_config.revisions','SELECT')
 OR has_table_privilege('titan_config_grants_login','titan_config.service_company_grants','SELECT')
 OR has_table_privilege('titan_config_grant_admin_login','titan_config.service_company_grants','INSERT')
 OR has_table_privilege('titan_config_authority_login','titan.company_memberships','SELECT')
 THEN RAISE EXCEPTION 'unexpected inherited SQL permission';END IF;
END $$;
