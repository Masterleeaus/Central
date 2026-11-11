\set ON_ERROR_STOP on
DO $$
BEGIN
 IF to_regclass('titan.identities') IS NULL OR
 NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='titan.identities'::regclass
 AND attname='logto_subject' AND atttypid='text'::regtype)
 THEN RAISE EXCEPTION 'canonical Logto identity contract mismatch';END IF;
END $$;
