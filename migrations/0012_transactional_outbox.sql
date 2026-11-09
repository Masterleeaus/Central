-- Transactional outbox, consumer dedupe and operator audit for cross-product events.
-- Applied after 0009. Migrations 0001 to 0009 are not edited. Versions 0010 and 0011 are
-- reserved by other work and are not present in this repository.
--
-- State changes write their outbox row in the same transaction (see packages/control-plane/src/outbox.ts),
-- so a rolled-back state change leaves no event behind.
--
-- Roles (created by 0006): titan_tenant_app is tenant-scoped on outbox_events (insert and select for its
-- own organisation only); titan_trusted_writer runs the publisher and operator replay and is cross-tenant.
-- Tenant scope is titan.organisation_id, read by titan.current_organisation_id() (0006).
--
-- Event contract: versioned by (event_type, schema_version). The list of accepted events lives in code
-- (EventRegistry); the database enforces shape, bounds and the status state machine only.
BEGIN;

CREATE TABLE titan.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  source_product text NOT NULL CHECK (source_product ~ '^[a-z][a-z0-9_-]{0,63}$'),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 1000),
  correlation_id text NOT NULL CHECK (char_length(correlation_id) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  -- Application limit is 4096 bytes of canonical JSON. jsonb text adds separators, so this backstop is larger.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 512),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE INDEX outbox_events_pending_idx ON titan.outbox_events (next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX outbox_events_dead_idx ON titan.outbox_events (created_at) WHERE status = 'dead';
CREATE INDEX outbox_events_organisation_idx ON titan.outbox_events (organisation_id, created_at);

-- Identity fields never change. Status moves pending -> published, pending -> dead, dead -> pending
-- (explicit operator replay). Published is terminal.
CREATE FUNCTION titan.outbox_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.source_product IS DISTINCT FROM OLD.source_product
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox event identity fields are immutable';
  END IF;
  IF OLD.status = 'published' AND NEW.status <> 'published' THEN
    RAISE EXCEPTION 'published outbox event cannot change status';
  END IF;
  IF OLD.status = 'dead' AND NEW.status NOT IN ('dead', 'pending') THEN
    RAISE EXCEPTION 'dead outbox event can only return to pending by operator replay';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outbox_events_guard BEFORE UPDATE ON titan.outbox_events
  FOR EACH ROW EXECUTE FUNCTION titan.outbox_events_guard();

-- Append-only record of publish attempts, dead letters and operator replays.
CREATE TABLE titan.outbox_event_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES titan.outbox_events (id),
  organisation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('published', 'attempt_failed', 'dead', 'operator_replay')),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 200),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 512),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_event_audit_event_idx ON titan.outbox_event_audit (event_id, id);

-- Consumer-side record of processed idempotency keys. Written in the same transaction as the handler's effect.
CREATE TABLE titan.outbox_processed_events (
  consumer text NOT NULL CHECK (char_length(consumer) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  organisation_id uuid NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, idempotency_key)
);

GRANT SELECT, INSERT ON titan.outbox_events TO titan_tenant_app;
GRANT SELECT, INSERT, UPDATE ON titan.outbox_events TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.outbox_event_audit TO titan_trusted_writer;
GRANT USAGE, SELECT ON SEQUENCE titan.outbox_event_audit_id_seq TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.outbox_processed_events TO titan_tenant_app, titan_trusted_writer;

ALTER TABLE titan.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_tenant_select ON titan.outbox_events FOR SELECT TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id());
CREATE POLICY outbox_events_tenant_insert ON titan.outbox_events FOR INSERT TO titan_tenant_app
  WITH CHECK (organisation_id = titan.current_organisation_id());
CREATE POLICY outbox_events_trusted_write ON titan.outbox_events FOR ALL TO titan_trusted_writer
  USING (true) WITH CHECK (true);

ALTER TABLE titan.outbox_processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.outbox_processed_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_processed_tenant_select ON titan.outbox_processed_events FOR SELECT TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id());
CREATE POLICY outbox_processed_tenant_insert ON titan.outbox_processed_events FOR INSERT TO titan_tenant_app
  WITH CHECK (organisation_id = titan.current_organisation_id());
CREATE POLICY outbox_processed_trusted_write ON titan.outbox_processed_events FOR ALL TO titan_trusted_writer
  USING (true) WITH CHECK (true);

COMMIT;
