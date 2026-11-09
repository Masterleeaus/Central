\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('titan_config_reader','titan_config_writer')
 AND (rolsuper OR rolbypassrls OR rolcanlogin))
 THEN RAISE EXCEPTION 'service role bypasses RLS';END IF;
END $$;
