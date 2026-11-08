-- REVIEW ONLY: NOT RUN OR APPLIED. Dedicated titan_central database. No modification to Logto's schema.
-- Does not establish an auth server or token validation. Plan with migration tool after architecture approval.
BEGIN;
CREATE SCHEMA IF NOT EXISTS titan;
CREATE TABLE IF NOT EXISTS titan.identities (
  id uuid PRIMARY KEY,
  logto_subject text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('active','blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS titan.organisations (
  id uuid PRIMARY KEY,
  logto_organisation_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS titan.memberships (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES titan.identities(id),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  role text NOT NULL CHECK (role IN ('owner','admin','manager','member','learner')),
  state text NOT NULL CHECK (state IN ('active','invited','suspended','revoked')),
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE(identity_id, organisation_id)
);
CREATE TABLE IF NOT EXISTS titan.entitlements (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  application_id text NOT NULL CHECK (application_id IN ('supercharged','sorted','lms')),
  state text NOT NULL CHECK (state IN ('active','trialing','paused','expired','revoked')),
  features text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE(organisation_id, application_id)
);
CREATE TABLE IF NOT EXISTS titan.local_account_links (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES titan.identities(id),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  application_id text NOT NULL CHECK (application_id IN ('supercharged','sorted','lms')),
  local_user_id text NOT NULL CHECK(length(local_user_id)>0),
  local_account_id text NOT NULL CHECK(length(local_account_id)>0),
  state text NOT NULL CHECK(state IN ('verified','revoked')),
  verified_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  UNIQUE(identity_id, organisation_id, application_id)
);
CREATE INDEX IF NOT EXISTS titan_member_org_idx ON titan.memberships(organisation_id, state);
CREATE INDEX IF NOT EXISTS titan_link_app_idx ON titan.local_account_links(application_id,local_account_id);
COMMIT;
