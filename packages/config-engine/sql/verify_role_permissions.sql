\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_reader','titan_config.audit','INSERT')
 OR has_table_privilege('titan_config_reader','titan_config.revisions','UPDATE')
 OR has_table_privilege('titan_config_writer','titan_config.audit','UPDATE')
 OR has_table_privilege('titan_config_writer','titan_config.revisions','TRUNCATE')
 THEN RAISE EXCEPTION 'configuration privilege escalation'; END IF;
END $$;
