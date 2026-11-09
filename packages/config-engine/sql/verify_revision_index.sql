\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='titan_config'
   AND tablename='revisions' AND indexdef LIKE '%PRIMARY KEY%') THEN
  RAISE EXCEPTION 'revision index missing';
 END IF;
END $$;
