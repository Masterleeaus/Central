\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_column_privilege('titan_config_reader','titan.schema_migrations','checksum_sha256','SELECT')
 OR has_table_privilege('titan_config_reader','titan.schema_migrations','INSERT')
 OR has_table_privilege('titan_config_reader','titan.schema_migrations','UPDATE')
 OR has_table_privilege('titan_config_reader','titan.schema_migrations','DELETE')
 THEN RAISE EXCEPTION 'receipt reader role can write or cannot read';END IF;
END $$;
