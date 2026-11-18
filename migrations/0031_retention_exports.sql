-- Migration 0031: store retention export files in the database (issue #16, owner decision 2026-11-18).
-- Applied after 0030. Migrations 0001 to 0030 are not edited.
--
-- Why: the purge job used to write its pre-delete CSV exports to a directory on the host. The owner decided
-- that exports belong in a database table, so the same backups cover them.
--
-- Scope of change:
--   * New table titan.retention_exports. One row per exported target table per purge run: the table name, the
--     cutoff used, the row count, a SHA-256 of the CSV body and the CSV body itself.
--   * The table is append-only for every role, including the owner: UPDATE, DELETE and TRUNCATE raise an error.
--     The purge job can therefore never remove or rewrite an export it has stored.
--   * Only titan_retention_purger may INSERT. No other role receives any privilege. PUBLIC has none.
--   * Nothing else changes. Migration 0028 and its carve-out are untouched.
--
-- Rollback: database/retention/rollback_0031.sql. It refuses to run while any export row exists.
BEGIN;

CREATE TABLE IF NOT EXISTS titan.retention_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('titan.activity_events', 'titan.provisioning_audit')),
  cutoff timestamptz NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  csv_body text NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION titan.reject_retention_export_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'titan.retention_exports is append-only: % is not permitted', TG_OP;
END
$$;

CREATE TRIGGER retention_exports_reject_row_change
  BEFORE UPDATE OR DELETE ON titan.retention_exports
  FOR EACH ROW EXECUTE FUNCTION titan.reject_retention_export_change();
CREATE TRIGGER retention_exports_reject_truncate
  BEFORE TRUNCATE ON titan.retention_exports
  FOR EACH STATEMENT EXECUTE FUNCTION titan.reject_retention_export_change();

REVOKE ALL ON titan.retention_exports FROM PUBLIC;
GRANT INSERT ON titan.retention_exports TO titan_retention_purger;

COMMENT ON TABLE titan.retention_exports IS
  'Pre-delete CSV exports written by tools/retention_purge.py (issue #16). Append-only. Only the purger inserts.';

COMMIT;
