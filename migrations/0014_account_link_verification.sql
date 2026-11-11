-- REVIEW BEFORE APPLYING. Issue #37: verified account links, relink and review.
-- Applied after 0009. Numbered 0014 as requested; 0010 to 0013 are not in this branch and the runner
-- accepts gaps (it only refuses a pending version lower than an applied one).
--
-- 1. A local account is verified for at most one identity and organisation per application.
--    If this index fails on existing data, resolve the duplicates through titan.link_reviews first.
-- 2. Nonce store for link assertions (docs/LINKING.md). Rows expire with their assertion.
-- 3. Review queue for ambiguous link attempts. Written only by CentralProvisioner; nothing resolves them automatically.
-- 4. Audit kind link_relink. Grants go to titan_trusted_writer only; no tenant or reader role gets them.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS local_account_links_verified_account_uniq
  ON titan.local_account_links (application_id, local_account_id) WHERE state = 'verified';

CREATE TABLE IF NOT EXISTS titan.link_assertion_nonces (
  product_id text NOT NULL CHECK (product_id IN ('sorted','supercharged','lms')),
  nonce text NOT NULL CHECK (length(nonce) BETWEEN 22 AND 128),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (product_id, nonce)
);
CREATE INDEX IF NOT EXISTS link_assertion_nonces_expiry_idx ON titan.link_assertion_nonces (expires_at);

CREATE TABLE IF NOT EXISTS titan.link_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  identity_id uuid NOT NULL REFERENCES titan.identities(id),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  application_id text NOT NULL CHECK (application_id IN ('desk','field','academy')),
  local_account_id text NOT NULL CHECK (length(local_account_id) > 0),
  reason text NOT NULL CHECK (reason IN ('existing_link_other_account','account_claimed_elsewhere','concurrent_conflict')),
  command_kind text NOT NULL CHECK (command_kind IN ('link','link_relink')),
  state text NOT NULL DEFAULT 'open' CHECK (state = 'open'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_reviews_open_idx ON titan.link_reviews (state, created_at);

ALTER TABLE titan.provisioning_audit DROP CONSTRAINT IF EXISTS provisioning_audit_command_kind_check;
ALTER TABLE titan.provisioning_audit ADD CONSTRAINT provisioning_audit_command_kind_check
  CHECK (command_kind IN ('identity','organisation','membership','entitlement','link','membership_update','entitlement_update','link_revoke','link_relink'));

GRANT SELECT, INSERT, DELETE ON titan.link_assertion_nonces TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.link_reviews TO titan_trusted_writer;

COMMIT;
