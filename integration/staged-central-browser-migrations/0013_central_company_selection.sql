-- Durable, one-use and browser-bound Central company selection.
-- The application stores the issuer, subject and permitted company IDs sealed
-- with AES-256-GCM; only the state digest and correlation digest are plaintext.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_central_selection') THEN
   CREATE ROLE titan_central_selection NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE TABLE titan.central_company_selection_states (
  state_digest char(64) PRIMARY KEY CHECK(state_digest ~ '^[0-9a-f]{64}$'),
  binding_hash char(64) NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
  sealed_issuer text NOT NULL,
  sealed_subject text NOT NULL,
  sealed_company_ids text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at),
  CHECK(expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX central_company_selection_expiry_idx ON titan.central_company_selection_states(expires_at);
ALTER TABLE titan.central_company_selection_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.central_company_selection_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON titan.central_company_selection_states FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_central_selection;
GRANT SELECT, INSERT, DELETE ON titan.central_company_selection_states TO titan_central_selection;
CREATE POLICY central_company_selection_role ON titan.central_company_selection_states
 FOR ALL TO titan_central_selection USING (true) WITH CHECK (true);
COMMENT ON TABLE titan.central_company_selection_states IS
 'Short-lived one-use company choice; sealed identity and allowed IDs, never browser-readable.';
COMMIT;
