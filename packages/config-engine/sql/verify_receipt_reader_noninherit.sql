\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_column_privilege('titan_config_api_login','titan.schema_migrations','checksum_sha256','SELECT')
 THEN RAISE EXCEPTION 'receipt read inherited without SET ROLE';END IF;
END $$;
