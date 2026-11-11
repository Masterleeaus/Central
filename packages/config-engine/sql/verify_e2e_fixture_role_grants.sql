\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_table_privilege('titan_config_grant_reader','titan_config.service_company_grants','SELECT')
 OR NOT has_table_privilege('titan_config_reader','titan_config.revisions','SELECT')
 THEN RAISE EXCEPTION 'E2E role SELECT grants missing'; END IF;
END $$;
