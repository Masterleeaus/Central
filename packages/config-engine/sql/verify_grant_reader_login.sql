\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_grant_reader'
 AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe grant role';END IF;
END $$;
