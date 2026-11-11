-- REVIEW ONLY. Never provision credentials here; migration owner is #43.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_api_login') THEN
 CREATE ROLE titan_config_api_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_grants_login') THEN
 CREATE ROLE titan_config_grants_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_grant_admin_login') THEN
 CREATE ROLE titan_config_grant_admin_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_authority_login') THEN
 CREATE ROLE titan_config_authority_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION; END IF;
END $$;
GRANT titan_config_reader TO titan_config_api_login WITH INHERIT FALSE, SET TRUE;
GRANT titan_config_grant_reader TO titan_config_grants_login WITH INHERIT FALSE, SET TRUE;
GRANT titan_config_grant_writer TO titan_config_grant_admin_login WITH INHERIT FALSE, SET TRUE;
GRANT titan_config_company_authority_reader TO titan_config_authority_login WITH INHERIT FALSE, SET TRUE;
COMMIT;
