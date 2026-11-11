\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_column_privilege('titan_config_grant_reader','titan.companies','status','SELECT')
 THEN RAISE EXCEPTION 'grant reader cannot inspect company status';END IF;
 IF has_table_privilege('titan_config_grant_reader','titan.companies','UPDATE')
 THEN RAISE EXCEPTION 'grant reader can modify company status';END IF;
END $$;
