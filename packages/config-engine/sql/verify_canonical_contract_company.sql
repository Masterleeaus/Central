\set ON_ERROR_STOP on
DO $$
BEGIN
 IF to_regclass('titan.companies') IS NULL OR
 NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='titan.companies'::regclass
 AND attname='id' AND atttypid='uuid'::regtype)
 THEN RAISE EXCEPTION 'canonical companies UUID contract mismatch';END IF;
END $$;
