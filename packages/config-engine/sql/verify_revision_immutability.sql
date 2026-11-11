\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_writer','titan_config.revisions','DELETE')
 OR has_table_privilege('titan_config_writer','titan_config.revisions','UPDATE')
 OR has_table_privilege('titan_config_writer','titan_config.revisions','TRUNCATE')
 THEN RAISE EXCEPTION 'revision history is mutable'; END IF;
END $$;
