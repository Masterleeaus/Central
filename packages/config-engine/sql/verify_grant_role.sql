\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_table_privilege('titan_config_grant_reader','titan_config.service_company_grants','SELECT') THEN
  RAISE EXCEPTION 'grant reader missing SELECT';END IF;
 IF has_table_privilege('titan_config_grant_reader','titan_config.service_company_grants','INSERT') OR
 has_table_privilege('titan_config_grant_reader','titan_config.service_company_grants','UPDATE') OR
 has_table_privilege('titan_config_reader','titan_config.service_company_grants','SELECT') THEN
 RAISE EXCEPTION 'grant privilege escalation';END IF;
END $$;
