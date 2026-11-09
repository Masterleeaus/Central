\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT revision FROM titan_config.scopes WHERE key='parallel_fixture')<>1
 OR (SELECT count(*) FROM titan_config.revisions WHERE key='parallel_fixture')<>1
 OR (SELECT count(*) FROM titan_config.audit WHERE key='parallel_fixture')<>1
 THEN RAISE EXCEPTION 'concurrent history and audit mismatch';END IF;
END $$;
