\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_schema_privilege('PUBLIC','titan_config','USAGE') THEN
  RAISE EXCEPTION 'PUBLIC has schema usage'; END IF;
 IF has_table_privilege('PUBLIC','titan_config.definitions','SELECT')
 OR has_table_privilege('PUBLIC','titan_config.audit','INSERT') THEN
  RAISE EXCEPTION 'PUBLIC has configuration privileges'; END IF;
END $$;
