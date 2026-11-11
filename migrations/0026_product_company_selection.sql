-- Product-specific one-use company selection state after verified OIDC.
-- Separate app namespace, browser binding and AES-GCM sealed identity/choices.
-- No product may read Central's company selection table, nor other apps.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_product_selection') THEN
   CREATE ROLE titan_product_selection NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE TABLE titan.product_company_selection_states(
 application_id text NOT NULL CHECK(application_id IN ('field','desk','academy')),
 state_digest char(64) NOT NULL CHECK(state_digest ~ '^[a-f0-9]{64}$'),
 binding_hash char(64) NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
 sealed_issuer text NOT NULL CHECK(length(sealed_issuer)>0),
 sealed_subject text NOT NULL CHECK(length(sealed_subject)>0),
 sealed_company_ids text NOT NULL CHECK(length(sealed_company_ids)>0),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(application_id,state_digest),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX product_company_selection_expiry
 ON titan.product_company_selection_states(expires_at);
ALTER TABLE titan.product_company_selection_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.product_company_selection_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON titan.product_company_selection_states FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_product_selection;
GRANT SELECT,INSERT,DELETE ON titan.product_company_selection_states
 TO titan_product_selection;
CREATE POLICY product_company_selection_role ON titan.product_company_selection_states
 FOR ALL TO titan_product_selection USING(true) WITH CHECK(true);
COMMENT ON TABLE titan.product_company_selection_states IS
 'Product-scoped one-use OIDC company choice; plaintext stores only app ID, state/binding digests and expiry.';
COMMIT;
