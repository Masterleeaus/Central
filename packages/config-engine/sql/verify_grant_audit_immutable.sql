\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_grant_writer','titan_config.service_grant_audit','UPDATE')
 OR has_table_privilege('titan_config_grant_writer','titan_config.service_grant_audit','TRUNCATE') THEN
 RAISE EXCEPTION 'grant audit mutable by restricted writer';END IF;
END $$;
