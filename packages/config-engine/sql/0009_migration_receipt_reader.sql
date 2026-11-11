-- DRAFT: approved migration ownership remains Issue #43.
BEGIN;
REVOKE ALL ON titan.schema_migrations FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_config_reader;
GRANT SELECT(migration_id,checksum_sha256) ON titan.schema_migrations TO titan_config_reader;
COMMIT;
