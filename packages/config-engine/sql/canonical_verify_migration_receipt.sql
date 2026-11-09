\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM titan.schema_migrations WHERE migration_id='0001_shared_company_core')<>1
 THEN RAISE EXCEPTION 'pinned canonical receipt missing';END IF;
 IF EXISTS(SELECT 1 FROM titan.schema_migrations WHERE migration_id='0001_shared_company_core'
 AND checksum_sha256 !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'invalid canonical receipt';END IF;
END $$;
