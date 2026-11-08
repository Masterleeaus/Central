-- Moves the OIDC login-state and session-revocation tables from the default
-- schema (created unqualified by 0003 and 0004) into the titan schema, so that
-- every Titan Central table lives in one schema. Indexes and constraints move
-- with their tables. Application queries must use titan.<table> names.
-- Applied exactly once by tools/migrate.py; not safe to re-run by hand.
BEGIN;
ALTER TABLE titan_oidc_login_states SET SCHEMA titan;
ALTER TABLE titan_session_revocations SET SCHEMA titan;
COMMIT;
