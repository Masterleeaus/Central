\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_company_authority_reader'
 AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe authority role';END IF;
END $$;
