-- Retention export store test for migration 0031 (issue #16).
-- Covers the insert-only grant to titan_retention_purger, the append-only trigger and the CHECK constraints
-- on titan.retention_exports.
--
-- Run as a superuser against a database where migrations 0001-0031 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/retention_exports_0031.sql "$DATABASE_URL"
-- or through tests/test_retention_exports_0031_db.py with TITAN_TEST_DATABASE_URL set.
--
-- Everything runs in one transaction that is rolled back at the end, so the database is left unchanged.
-- Any check that fails raises an exception and psql exits non-zero.
\set ON_ERROR_STOP on
BEGIN;

-- Runs the statement and expects it to be refused for any reason.
CREATE FUNCTION pg_temp.expect_rejected(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  RAISE EXCEPTION 'not rejected: %', label USING ERRCODE = 'P0002';
END
$$;

-- Runs the statement and expects exactly expected rows to be affected.
CREATE FUNCTION pg_temp.expect_affected(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: affected % rows, expected %', label, n, expected USING ERRCODE = 'P0002';
  END IF;
END
$$;

-- 1. The table exists and the purger may insert an export row.
DO $$
BEGIN
  IF to_regclass('titan.retention_exports') IS NULL THEN
    RAISE EXCEPTION 'titan.retention_exports is missing; migration 0031 not applied' USING ERRCODE = 'P0002';
  END IF;
END
$$;

SET LOCAL ROLE titan_retention_purger;
SELECT pg_temp.expect_affected('purger stores an export', $q$INSERT INTO titan.retention_exports (table_name, cutoff, row_count, body_sha256, csv_body)
  VALUES ('titan.activity_events', now(), 1, repeat('a', 64), 'occurred_at,id' || E'\n' || '2026-01-01 00:00:00+00,a1' || E'\n')$q$, 1);
-- The purger cannot change or remove what it stored, and cannot read it back.
SELECT pg_temp.expect_rejected('purger update of export', $q$UPDATE titan.retention_exports SET row_count = 0$q$);
SELECT pg_temp.expect_rejected('purger delete of export', $q$DELETE FROM titan.retention_exports$q$);
SELECT pg_temp.expect_rejected('purger read of export', $q$SELECT 1 FROM titan.retention_exports$q$);
RESET ROLE;

-- 2. Nobody can change or remove an export, including the owner and superuser. The trigger refuses every change.
SELECT pg_temp.expect_rejected('owner update of export', $q$UPDATE titan.retention_exports SET row_count = 0$q$);
SELECT pg_temp.expect_rejected('owner delete of export', $q$DELETE FROM titan.retention_exports$q$);
SELECT pg_temp.expect_rejected('owner truncate of export', 'TRUNCATE titan.retention_exports');

-- 3. A role outside the purger receives no insert right.
CREATE ROLE titan_export_outsider NOLOGIN;
GRANT USAGE ON SCHEMA titan TO titan_export_outsider;
SET LOCAL ROLE titan_export_outsider;
SELECT pg_temp.expect_rejected('outsider insert into export', $q$INSERT INTO titan.retention_exports (table_name, cutoff, row_count, body_sha256, csv_body)
  VALUES ('titan.activity_events', now(), 0, repeat('b', 64), 'x')$q$);
RESET ROLE;

-- 4. CHECK constraints refuse a bad checksum, an unknown table and a negative row count.
SELECT pg_temp.expect_rejected('short checksum', $q$INSERT INTO titan.retention_exports (table_name, cutoff, row_count, body_sha256, csv_body)
  VALUES ('titan.activity_events', now(), 0, 'abc', 'x')$q$);
SELECT pg_temp.expect_rejected('unknown table', $q$INSERT INTO titan.retention_exports (table_name, cutoff, row_count, body_sha256, csv_body)
  VALUES ('titan.organisations', now(), 0, repeat('c', 64), 'x')$q$);
SELECT pg_temp.expect_rejected('negative row count', $q$INSERT INTO titan.retention_exports (table_name, cutoff, row_count, body_sha256, csv_body)
  VALUES ('titan.activity_events', now(), -1, repeat('d', 64), 'x')$q$);

DO $$ BEGIN RAISE NOTICE 'retention exports 0031: all checks passed'; END $$;

ROLLBACK;
