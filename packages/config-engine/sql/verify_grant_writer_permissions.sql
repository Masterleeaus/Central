\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_table_privilege('titan_config_grant_writer','titan_config.service_company_grants','INSERT')
 OR NOT has_table_privilege('titan_config_grant_writer','titan_config.service_company_grants','SELECT')
 OR has_table_privilege('titan_config_grant_writer','titan_config.service_company_grants','DELETE')
 OR has_table_privilege('titan_config_grant_writer','titan_config.service_grant_audit','INSERT')
 OR has_table_privilege('titan_config_grant_writer','titan_config.service_grant_audit','DELETE') THEN
  RAISE EXCEPTION 'grant writer privileges invalid';END IF;
END $$;
