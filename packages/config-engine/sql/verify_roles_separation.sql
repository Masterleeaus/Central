\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('titan_config_reader','titan_config.scopes','INSERT')
 OR has_table_privilege('titan_config_reader','titan_config.scopes','UPDATE')
 OR has_table_privilege('titan_config_reader','titan_config.scopes','DELETE') THEN
  RAISE EXCEPTION 'reader can modify active scope'; END IF;
 IF NOT has_table_privilege('titan_config_reader','titan_config.scopes','SELECT')
 THEN RAISE EXCEPTION 'reader cannot read active scope'; END IF;
END $$;
