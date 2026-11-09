-- Migration 0016: durable, one-use organisation selection store (issue #32).
-- Applied after 0001 to 0009. Migrations 0014 and 0015 belong to other open branches and are not
-- on this base. Never edit this file once applied.
--
-- A user who belongs to several eligible organisations gets a pending selection after identity
-- verification. Each row binds the pending choice to:
--   - the one-use OIDC state, by state_digest (SHA-256 of the state, base64url; the state is never stored),
--   - the browser binding, by binding_hash (SHA-256 of the binding cookie; the cookie is never stored),
--   - the selection token, by selection_hash (SHA-256 of the token; the token is never stored).
-- It also holds the candidate organisation IDs, the verified issuer and subject, the sealed ID token,
-- an expiry and a consumed_at marker.
--
-- One use: consume is a single statement that claims the row only while consumed_at IS NULL and
-- expires_at > now. A replay, a second concurrent consume, or an expired row finds nothing and fails closed.
--
-- Tenant safety: a selection exists before any tenant context is known, so this table is not
-- tenant-scoped and has no RLS. It is deliberately NOT granted to titan_tenant_app or
-- titan_trusted_reader, so no browser-facing or reporting role can read it. The writer reads a row only by
-- (application_id, binding_hash), so one browser cannot read or consume another browser's selection.
-- organisation_ids is only a candidate list: the application adapter re-checks membership, entitlement and
-- the local account for the chosen organisation before any session is created.
BEGIN;

CREATE TABLE IF NOT EXISTS titan.titan_oidc_organisation_selections (
  application_id text NOT NULL CHECK (application_id IN ('desk','field','academy')),
  binding_hash text NOT NULL CHECK (length(binding_hash) = 43),
  state_digest text NOT NULL CHECK (length(state_digest) = 43),
  selection_hash text NOT NULL CHECK (length(selection_hash) = 43),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  organisation_ids text[] NOT NULL CHECK (cardinality(organisation_ids) BETWEEN 2 AND 128),
  sealed_id_token text CHECK (sealed_id_token IS NULL OR length(sealed_id_token) <= 32768),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, binding_hash),
  -- One OIDC state can start at most one pending selection.
  CONSTRAINT titan_oidc_org_selections_state_once UNIQUE (application_id, state_digest),
  -- A consumed row never keeps its sealed ID token.
  CONSTRAINT titan_oidc_org_selections_consumed_clean CHECK (consumed_at IS NULL OR sealed_id_token IS NULL)
);

-- Pruning finds expired and consumed rows by expiry.
CREATE INDEX IF NOT EXISTS titan_oidc_org_selections_expiry_idx
  ON titan.titan_oidc_organisation_selections (expires_at);

-- Least privilege: only titan_trusted_writer touches this table, and only the columns its statements use.
--   save     INSERT the pending row. created_at takes its default, so it is not granted.
--            There is no UPDATE on save: a duplicate binding or state fails closed instead of overwriting.
--   consume  SELECT the columns it reads and returns, and UPDATE consumed_at and sealed_id_token to claim the row.
--            SELECT ... FOR UPDATE also needs UPDATE privilege, which the column grant provides.
--   prune    SELECT the key and expiry columns, and DELETE expired or consumed rows.
-- Nothing is granted to titan_trusted_reader, titan_tenant_app or the login role (titan_central_app).
GRANT INSERT (application_id, binding_hash, state_digest, selection_hash, issuer, subject, organisation_ids, sealed_id_token, expires_at)
  ON titan.titan_oidc_organisation_selections TO titan_trusted_writer;
GRANT SELECT (application_id, binding_hash, state_digest, selection_hash, issuer, subject, organisation_ids, sealed_id_token, expires_at, consumed_at)
  ON titan.titan_oidc_organisation_selections TO titan_trusted_writer;
GRANT UPDATE (consumed_at, sealed_id_token) ON titan.titan_oidc_organisation_selections TO titan_trusted_writer;
GRANT DELETE ON titan.titan_oidc_organisation_selections TO titan_trusted_writer;

COMMIT;
