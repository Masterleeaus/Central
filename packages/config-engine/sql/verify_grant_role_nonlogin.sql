\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_grant_writer'
 AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
 RAISE EXCEPTION 'grant writer can bypass boundary';END IF;
END $$;
