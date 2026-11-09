-- REVIEW ONLY: merge through canonical migration authority, issue #43.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_config_reader') THEN CREATE ROLE titan_config_reader NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_config_writer') THEN CREATE ROLE titan_config_writer NOLOGIN NOINHERIT; END IF;
END $$;
GRANT USAGE ON SCHEMA titan_config TO titan_config_reader,titan_config_writer;
GRANT SELECT ON titan_config.definitions,titan_config.scopes,titan_config.revisions TO titan_config_reader,titan_config_writer;
GRANT INSERT ON titan_config.scopes,titan_config.revisions,titan_config.audit TO titan_config_writer;
GRANT UPDATE(revision) ON titan_config.scopes TO titan_config_writer;
GRANT USAGE ON SEQUENCE titan_config.audit_id_seq TO titan_config_writer;
COMMIT;
