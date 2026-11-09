-- Short-lived product-account ownership proof nonces: one use across workers.
-- No product signing key, user email, token, or raw nonce is persisted.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_product_link_nonce') THEN
  CREATE ROLE titan_product_link_nonce NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_product_link_nonce_owner') THEN
  CREATE ROLE titan_product_link_nonce_owner NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE TABLE titan.product_link_proof_nonces(
 application_id text NOT NULL CHECK(application_id IN ('field','desk','academy')),
 nonce_digest char(64) NOT NULL CHECK(nonce_digest ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(application_id,nonce_digest),
 CHECK(expires_at>claimed_at AND expires_at<=claimed_at+interval '2 minutes')
);
ALTER TABLE titan.product_link_proof_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.product_link_proof_nonces FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA titan TO titan_product_link_nonce,titan_product_link_nonce_owner;
GRANT INSERT ON titan.product_link_proof_nonces TO titan_product_link_nonce_owner;
GRANT SELECT(application_id,nonce_digest)
 ON titan.product_link_proof_nonces TO titan_product_link_nonce_owner;
CREATE POLICY product_nonce_insert ON titan.product_link_proof_nonces
 FOR INSERT TO titan_product_link_nonce_owner
 WITH CHECK(expires_at>claimed_at AND expires_at<=claimed_at+interval '2 minutes');
CREATE POLICY product_nonce_return ON titan.product_link_proof_nonces
 FOR SELECT TO titan_product_link_nonce_owner USING(true);

CREATE FUNCTION titan.claim_product_link_proof_nonce(
 p_application_id text,p_nonce_digest char(64),p_expires_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,titan
SET row_security=on
AS $$
DECLARE inserted boolean;
BEGIN
 IF p_application_id NOT IN ('field','desk','academy') OR
    p_nonce_digest IS NULL OR p_nonce_digest !~ '^[a-f0-9]{64}$' OR
    p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR
    p_expires_at>clock_timestamp()+interval '2 minutes'
 THEN RETURN false; END IF;
 INSERT INTO titan.product_link_proof_nonces(application_id,nonce_digest,expires_at)
 VALUES(p_application_id,p_nonce_digest,p_expires_at)
 ON CONFLICT DO NOTHING RETURNING true INTO inserted;
 RETURN coalesce(inserted,false);
END $$;
REVOKE ALL ON FUNCTION titan.claim_product_link_proof_nonce(text,char(64),timestamptz)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.claim_product_link_proof_nonce(text,char(64),timestamptz)
 TO titan_product_link_nonce;
GRANT CREATE ON SCHEMA titan TO titan_product_link_nonce_owner;
ALTER FUNCTION titan.claim_product_link_proof_nonce(text,char(64),timestamptz)
 OWNER TO titan_product_link_nonce_owner;
REVOKE CREATE ON SCHEMA titan FROM titan_product_link_nonce_owner;
COMMENT ON FUNCTION titan.claim_product_link_proof_nonce(text,char(64),timestamptz) IS
 'Single-use product proof nonce claim. Signature and command binding MUST be checked before calling. Not a provisioning permission.';
COMMIT;
