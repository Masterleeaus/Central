-- Migration 0011: append-only activity history (GitHub issue #36).
-- Applied after 0009. Migrations 0001 to 0009 are not edited. Number 0010 is reserved by another change.
--
-- One row per significant lifecycle event (provisioning, onboarding, product activation, account
-- linking, workflow handoff). Product business activity stays in its owning product; a row holds only
-- a reference (target_type, target_id), the source product and a small redacted detail object.
-- Redaction runs in the application before insert (packages/control-plane/src/activity-redaction.ts).
-- The CHECK constraints below are the second line: they refuse oversized, nested or secret-shaped data
-- even if a caller skips the application redaction.
--
-- Append-only is enforced in three layers:
--   1. Privileges: no role receives UPDATE, DELETE or TRUNCATE. PUBLIC has no privilege at all.
--   2. Trigger: every UPDATE, DELETE and TRUNCATE raises an error, for every role including the table owner.
--      Limit: a superuser can set session_replication_role = replica and skip triggers. The application must
--      not connect as a superuser or a BYPASSRLS role (same rule as migration 0006).
--   3. Row-level security with FORCE, so the owner is subject to the policies below as well.
--
-- Roles, as defined in migration 0006:
--   titan_trusted_writer  INSERT and SELECT. Provisioning writes events in the same transaction as the
--                         lifecycle change, so it needs INSERT. It gets SELECT only so that a
--                         writer-side read is tenant-scoped; the writer cannot enumerate other tenants.
--   titan_trusted_reader  SELECT only. It is the tenant-scoped reader for the query function.
--   titan_tenant_app      no privilege. Tenant users reach events only through a server-side reader
--                         that sets the organisation scope, never by a direct grant.
BEGIN;

-- Size and shape bound for the detail object. Flat object, at most 12 keys, each key 1 to 32 characters,
-- scalar values only (string up to 128 characters, number, boolean, null), total text at most 1024 bytes.
-- Anything else is refused. IMMUTABLE so it can be used in a CHECK constraint.
CREATE OR REPLACE FUNCTION titan.activity_detail_ok(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN RETURN false; END IF;
  IF octet_length(d::text) > 1024 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_each(d)) > 12 THEN RETURN false; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(d) LOOP
    IF k !~ '^[A-Za-z][A-Za-z0-9_]{0,31}$' THEN RETURN false; END IF;
    IF jsonb_typeof(v) NOT IN ('string', 'number', 'boolean', 'null') THEN RETURN false; END IF;
    IF jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') > 128 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

CREATE TABLE IF NOT EXISTS titan.activity_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('subject', 'service')),
  -- The actor is an opaque subject or service id. An address-shaped value (containing '@') is refused,
  -- so an email cannot be stored as the actor.
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 256 AND actor_id !~ '[[:space:][:cntrl:]@]'),
  action text NOT NULL CHECK (char_length(action) <= 64 AND action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z][a-z0-9_]{0,31}$'),
  target_id text NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 128 AND target_id !~ '[[:space:][:cntrl:]@]'),
  source_product text NOT NULL CHECK (source_product IN ('sorted', 'supercharged', 'lms', 'central')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  -- Shared across Central and connected products, so one lifecycle chain can be followed end to end.
  correlation_id text NOT NULL CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (titan.activity_detail_ok(detail)),
  -- Provenance: the database role that wrote the row. Set by the server, never supplied by the caller.
  recorded_by text NOT NULL DEFAULT current_user CHECK (char_length(recorded_by) BETWEEN 1 AND 64)
);

COMMENT ON TABLE titan.activity_events IS
  'Append-only lifecycle activity history (issue #36). Written by titan_trusted_writer. Never updated or deleted.';

CREATE INDEX IF NOT EXISTS titan_activity_org_time_idx ON titan.activity_events (organisation_id, occurred_at DESC, event_id DESC);
CREATE INDEX IF NOT EXISTS titan_activity_correlation_idx ON titan.activity_events (correlation_id);

-- Append-only trigger. Rejects UPDATE and DELETE (row level) and TRUNCATE (statement level) for every role.
CREATE OR REPLACE FUNCTION titan.reject_activity_event_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'titan.activity_events is append-only: % is not permitted', TG_OP;
END
$$;

CREATE TRIGGER activity_events_reject_row_change
  BEFORE UPDATE OR DELETE ON titan.activity_events
  FOR EACH ROW EXECUTE FUNCTION titan.reject_activity_event_change();
CREATE TRIGGER activity_events_reject_truncate
  BEFORE TRUNCATE ON titan.activity_events
  FOR EACH STATEMENT EXECUTE FUNCTION titan.reject_activity_event_change();

ALTER TABLE titan.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.activity_events FORCE ROW LEVEL SECURITY;

-- Privileges. PUBLIC is revoked first so no role inherits access by default.
-- INSERT for the writer: events are recorded inside the lifecycle transaction (provisioning).
-- SELECT for the writer: needed only for the scoped policy below; no UPDATE or DELETE is granted to anyone.
-- SELECT for the trusted reader: the tenant-scoped query function reads events for one organisation.
REVOKE ALL ON titan.activity_events FROM PUBLIC;
GRANT INSERT, SELECT ON titan.activity_events TO titan_trusted_writer;
GRANT SELECT ON titan.activity_events TO titan_trusted_reader;

-- Policies.
-- Reader: an organisation sees only its own events. With no organisation set, current_organisation_id()
-- is NULL and no row matches (fail closed). A malformed setting raises an error (fail closed).
-- Same pattern as migrations 0006 and 0008.
CREATE POLICY activity_events_trusted_read ON titan.activity_events FOR SELECT TO titan_trusted_reader
  USING (organisation_id = titan.current_organisation_id());
-- Writer insert: unrestricted by organisation, because provisioning is cross-tenant by design and is
-- separately authorised (see migration 0006). The row's organisation is still required and checked above.
CREATE POLICY activity_events_writer_insert ON titan.activity_events FOR INSERT TO titan_trusted_writer
  WITH CHECK (true);
-- Writer read: scoped to one organisation, so the writer role cannot list events across tenants.
-- Consequence: INSERT ... RETURNING fails for the writer unless an organisation is set, because RETURNING needs
-- this policy to pass on the new row. The recorder therefore generates event_id itself and does not use RETURNING.
CREATE POLICY activity_events_writer_read ON titan.activity_events FOR SELECT TO titan_trusted_writer
  USING (organisation_id = titan.current_organisation_id());

COMMIT;
