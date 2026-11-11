\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
 ('titan_config_reader','titan_config_grant_reader','titan_config_grant_writer','titan_config_company_authority_reader')
 AND (rolcanlogin OR rolsuper OR rolbypassrls))
 THEN RAISE EXCEPTION 'permission role is unsafe';END IF;
END $$;
