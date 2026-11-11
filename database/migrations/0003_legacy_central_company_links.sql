-- Staged bridge between the existing Central organisation registry and the
-- new canonical titan.companies schema. The two UUID domains are not presumed
-- interchangeable. Only a reviewed verified mapping can be used by a gateway.
BEGIN;
CREATE TABLE titan.central_legacy_company_links(
  legacy_organisation_id uuid PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES titan.companies(id) ON DELETE RESTRICT,
  logto_organisation_id text NOT NULL UNIQUE CHECK(length(btrim(logto_organisation_id))>0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','revoked')),
  verified_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='verified' AND verified_at IS NOT NULL) OR status<>'verified')
);
CREATE INDEX central_legacy_company_links_company_idx
 ON titan.central_legacy_company_links(company_id,status);
ALTER TABLE titan.central_legacy_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.central_legacy_company_links FORCE ROW LEVEL SECURITY;
-- Scoped reader can inspect verified mappings for only its selected canonical
-- company; the actor that approves mappings must be a separate audited writer.
GRANT SELECT ON titan.central_legacy_company_links TO titan_shared_company_reader;
CREATE POLICY central_legacy_mapping_read ON titan.central_legacy_company_links
 FOR SELECT TO titan_shared_company_reader
 USING(company_id=titan.current_company_id() AND status='verified');
COMMENT ON TABLE titan.central_legacy_company_links IS
 'Explicit, reviewed one-to-one legacy Central organisation to canonical company mapping. Pending/revoked links cannot grant access.';
COMMIT;
