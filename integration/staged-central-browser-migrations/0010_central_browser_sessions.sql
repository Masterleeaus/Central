-- Central browser sessions. Review-only until deployed by the ordered migration
-- runner. Sessions authenticate browsers before tenant selection; therefore
-- tenant scoping is enforced by an opaque 256-bit token digest and an isolated
-- NOLOGIN database role rather than a user-supplied company setting.
BEGIN;
CREATE ROLE titan_central_sessions NOLOGIN NOINHERIT;
CREATE TABLE titan.central_browser_sessions (
  token_digest char(64) PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
  logto_subject text NOT NULL CHECK(length(logto_subject) BETWEEN 1 AND 256),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '8 hours 1 minute')
);
CREATE INDEX central_browser_sessions_expiry_idx ON titan.central_browser_sessions(expires_at);
ALTER TABLE titan.central_browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.central_browser_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON titan.central_browser_sessions FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_central_sessions;
GRANT SELECT, INSERT, DELETE ON titan.central_browser_sessions TO titan_central_sessions;
CREATE POLICY central_sessions_role ON titan.central_browser_sessions
 FOR ALL TO titan_central_sessions USING (true) WITH CHECK (true);
COMMENT ON TABLE titan.central_browser_sessions IS
 'Central-only opaque browser session digests; grants limited to dedicated session role. No raw bearer tokens.';
COMMIT;
