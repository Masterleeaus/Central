\set ON_ERROR_STOP on
DO $$ BEGIN
 IF to_regclass('titan_config.definitions') IS NULL OR to_regclass('titan_config.scopes') IS NULL
 OR to_regclass('titan_config.revisions') IS NULL OR to_regclass('titan_config.audit') IS NULL
 THEN RAISE EXCEPTION 'configuration schema missing'; END IF;
END $$;
