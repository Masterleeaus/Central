-- Canonical migration registry verification. Must run only after
-- tools/migrate_shared.py has applied the clean canonical chain.
\set ON_ERROR_STOP on
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.schema_migrations;
 IF n<>11 THEN RAISE EXCEPTION 'Expected eleven canonical migration records, observed %',n; END IF;
 IF (SELECT string_agg(left(migration_id,4),',' ORDER BY migration_id)
     FROM titan.schema_migrations) <> '0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,0011'
 THEN RAISE EXCEPTION 'Unexpected canonical migration IDs'; END IF;
 IF EXISTS(
  SELECT 1 FROM titan.schema_migrations
  WHERE checksum_sha256 !~ '^[0-9a-f]{64}$'
 ) THEN RAISE EXCEPTION 'Invalid canonical SHA-256 checksum'; END IF;
 IF to_regclass('titan.organisations') IS NOT NULL THEN
  RAISE EXCEPTION 'Legacy Central organisations must not be created in canonical database'; END IF;
 IF to_regclass('public.schema_migrations') IS NOT NULL THEN
  RAISE EXCEPTION 'Legacy migration registry must not be created in canonical database'; END IF;
END $$;
\echo canonical migration registry is authoritative
