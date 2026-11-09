\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='titan_config'
 AND policyname IN ('scope_reader','scope_writer_insert','scope_writer_update',
 'revision_reader','revision_writer_insert','audit_writer_insert'))<>6
 THEN RAISE EXCEPTION 'incomplete RLS policies'; END IF;
END $$;
