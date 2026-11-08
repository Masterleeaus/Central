BEGIN;
-- Apply only to Titan Central's OWN dedicated PostgreSQL database after review.
-- Do not apply to Logto, titan_desk, ai_fsm or titan_academy databases.
CREATE TABLE IF NOT EXISTS titan_oidc_login_states (
  application_id text NOT NULL CHECK (application_id IN ('desk','field','academy')),
  state_digest text NOT NULL CHECK (length(state_digest)=64),
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  binding_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id,state_digest)
);
CREATE INDEX IF NOT EXISTS titan_oidc_login_states_expiry_idx ON titan_oidc_login_states (expires_at);
-- Operate scheduled expiry pruning with narrow privileges. Never return pending
-- state data through public HTTP routes.
COMMIT;
