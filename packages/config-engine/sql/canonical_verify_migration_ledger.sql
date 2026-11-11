\set ON_ERROR_STOP on
DO $$ BEGIN IF to_regclass('titan.schema_migrations') IS NULL THEN RAISE EXCEPTION 'canonical migration ledger missing';END IF; END $$;
