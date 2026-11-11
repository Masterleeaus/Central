\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('titan_config_api_login','titan_config_grants_login','titan_config_grant_admin_login','titan_config_authority_login'))<>4
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('titan_config_api_login','titan_config_grants_login','titan_config_grant_admin_login','titan_config_authority_login')
 AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
 THEN RAISE EXCEPTION 'unsafe service login';END IF;
END $$;
