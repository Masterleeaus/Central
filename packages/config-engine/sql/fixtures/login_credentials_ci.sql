-- Disposable PostgreSQL CI only. NEVER use these credentials in a deployment.
BEGIN;
ALTER ROLE titan_config_api_login PASSWORD 'ci-config-api-only';
ALTER ROLE titan_config_grants_login PASSWORD 'ci-config-grants-only';
ALTER ROLE titan_config_grant_admin_login PASSWORD 'ci-grant-admin-only';
ALTER ROLE titan_config_authority_login PASSWORD 'ci-company-authority-only';
COMMIT;
