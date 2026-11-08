BEGIN;
-- REVIEW BEFORE APPLYING. Titan Central database ONLY (not Logto/Desk/Field/Academy).
-- Session stores snapshot generation at issuance; the guard verifies current version
-- on every protected request; trusted admin writes increment generation.
CREATE TABLE IF NOT EXISTS titan_session_revocations (
  application_id text NOT NULL CHECK (application_id IN ('desk','field','academy')),
  logto_subject text NOT NULL CHECK (length(logto_subject) BETWEEN 1 AND 200),
  organisation_id text NOT NULL CHECK (length(organisation_id) BETWEEN 1 AND 200),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, logto_subject, organisation_id)
);
-- Grant SELECT to the trusted guard role only. Increment privileges must be
-- restricted to a server-side trusted provisioning identity; never a browser.
COMMIT;
