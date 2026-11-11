-- Titan shared PostgreSQL schema — migration 0001
-- This is the first migration in the new Central-authoritative chain.
-- Apply to a clean shared Titan application database; do not run together with
-- the legacy review-only migrations in /migrations.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS titan;

CREATE TABLE titan.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE titan.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logto_subject text NOT NULL UNIQUE CHECK (length(btrim(logto_subject)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE titan.company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES titan.identities(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member', 'learner')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'revoked')),
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, identity_id)
);

CREATE TABLE titan.application_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
  application_id text NOT NULL CHECK (application_id IN ('central', 'sorted', 'lms', 'supercharged')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'paused', 'expired', 'revoked')),
  features text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, application_id)
);

-- Transitional mapping from each app's pre-unification tenant identifier to
-- the canonical UUID. This can be retired after every app has adopted company_id.
CREATE TABLE titan.application_company_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
  application_id text NOT NULL CHECK (application_id IN ('sorted', 'lms', 'supercharged')),
  local_company_id text NOT NULL CHECK (length(btrim(local_company_id)) > 0),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'revoked')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, application_id),
  UNIQUE (application_id, local_company_id)
);

-- A shared identity can map to an app-specific user/profile ID. The app-local
-- user IDs stay text because the current repos use different ID formats.
CREATE TABLE titan.application_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES titan.identities(id) ON DELETE RESTRICT,
  application_id text NOT NULL CHECK (application_id IN ('sorted', 'lms', 'supercharged')),
  local_user_id text NOT NULL CHECK (length(btrim(local_user_id)) > 0),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'revoked')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, identity_id, application_id),
  UNIQUE (company_id, application_id, local_user_id)
);

CREATE INDEX titan_membership_identity_status_idx
  ON titan.company_memberships(identity_id, status);
CREATE INDEX titan_entitlement_company_status_idx
  ON titan.application_entitlements(company_id, status);
CREATE INDEX titan_company_link_app_local_idx
  ON titan.application_company_links(application_id, local_company_id);
CREATE INDEX titan_user_link_app_local_idx
  ON titan.application_user_links(application_id, local_user_id);

CREATE TABLE titan.schema_migrations (
  migration_id text PRIMARY KEY,
  checksum_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);

COMMIT;
