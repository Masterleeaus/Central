\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid='titan_config.revisions'::regclass
     AND contype='p'
     AND array_length(conkey,1)=6
 ) THEN
  RAISE EXCEPTION 'revision primary key missing or incomplete';
 END IF;
END $$;
