-- DRAFT ONLY: canonical company FK awaits Issue #43.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_grant_reader') THEN
  CREATE ROLE titan_config_grant_reader NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE TABLE titan_config.service_company_grants (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9:_-]{1,256}$'),
 product text NOT NULL CHECK(product IN ('central','sorted','supercharged','lms')),
 environment text NOT NULL CHECK(environment ~ '^[a-z][a-z0-9_-]{0,63}$'),
 company_id uuid NOT NULL,
 cohorts text[] NOT NULL DEFAULT '{}'::text[] CHECK(cardinality(cohorts)<=32),
 state text NOT NULL CHECK(state IN ('active','suspended','revoked')),
 expires_at timestamptz,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,product,environment,company_id)
);
CREATE INDEX config_grant_lookup_idx ON titan_config.service_company_grants(client_id,product,environment,state,expires_at);
REVOKE ALL ON titan_config.service_company_grants FROM PUBLIC;
GRANT USAGE ON SCHEMA titan_config TO titan_config_grant_reader;
GRANT SELECT ON titan_config.service_company_grants TO titan_config_grant_reader;
COMMIT;
