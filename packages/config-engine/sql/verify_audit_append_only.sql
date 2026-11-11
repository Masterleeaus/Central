\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_writer','titan_config.audit','UPDATE')
 OR has_table_privilege('titan_config_writer','titan_config.audit','DELETE')
 OR has_table_privilege('titan_config_writer','titan_config.audit','TRUNCATE')
 THEN RAISE EXCEPTION 'audit history is mutable by writer'; END IF;
 IF NOT has_table_privilege('titan_config_writer','titan_config.audit','INSERT')
 THEN RAISE EXCEPTION 'writer cannot append audit'; END IF;
END $$;
