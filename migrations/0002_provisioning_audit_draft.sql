-- REVIEW ONLY. Apply only to a dedicated titan_central database after 0001.
-- The provisioning caller must be server-trusted and separately authorised; no public mutation route.
BEGIN;
CREATE TABLE IF NOT EXISTS titan.provisioning_audit (
 request_id uuid PRIMARY KEY,
 actor_subject text NOT NULL,
 authority_reference text NOT NULL,
 command_kind text NOT NULL CHECK(command_kind IN ('identity','organisation','membership','entitlement','link')),
 command_digest text NOT NULL,
 subject_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provisioning_audit_actor_idx ON titan.provisioning_audit(actor_subject,created_at DESC);
COMMIT;
