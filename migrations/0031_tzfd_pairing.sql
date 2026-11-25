-- Front Desk WordPress pairing (contract tzfd-pair/1, Central issue #189).
-- Pairing codes are single use. Only a SHA-256 digest of each code is stored, never the code.
-- The site secret is stored as issued. At-rest encryption of the secret is a follow-up (Front Desk PR #427, decision 3).
-- One SECURITY DEFINER function consumes the code and binds the site in one statement, so a refused binding
-- (site already bound to another company) rolls back the code use as well.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_tzfd_pair') THEN
  CREATE ROLE titan_tzfd_pair NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_tzfd_pair_owner') THEN
  CREATE ROLE titan_tzfd_pair_owner NOLOGIN NOINHERIT;
 END IF;
END $$;

CREATE TABLE titan.tzfd_pairing_codes(
 code_digest char(64) PRIMARY KEY CHECK(code_digest ~ '^[a-f0-9]{64}$'),
 company_uuid uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 CHECK(used_at IS NULL OR used_at>=created_at)
);

CREATE TABLE titan.tzfd_site_secrets(
 site_id text PRIMARY KEY CHECK(site_id ~ '^site-[a-f0-9]{24}$'),
 company_uuid uuid NOT NULL,
 secret char(64) NOT NULL CHECK(secret ~ '^[a-f0-9]{64}$'),
 paired_at timestamptz NOT NULL
);

ALTER TABLE titan.tzfd_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.tzfd_pairing_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE titan.tzfd_site_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.tzfd_site_secrets FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA titan TO titan_tzfd_pair,titan_tzfd_pair_owner;
GRANT SELECT,INSERT,UPDATE ON titan.tzfd_pairing_codes TO titan_tzfd_pair_owner;
GRANT SELECT,INSERT,UPDATE ON titan.tzfd_site_secrets TO titan_tzfd_pair_owner;
CREATE POLICY tzfd_codes_owner ON titan.tzfd_pairing_codes
 FOR ALL TO titan_tzfd_pair_owner USING(true) WITH CHECK(true);
CREATE POLICY tzfd_secrets_owner ON titan.tzfd_site_secrets
 FOR ALL TO titan_tzfd_pair_owner USING(true) WITH CHECK(true);

-- The database clock is the only clock for code expiry and use, so no caller clock can skew the checks.
CREATE FUNCTION titan.pair_tzfd_site(
 p_code_digest char(64),p_site_id text,p_secret char(64))
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,titan
SET row_security=on
AS $$
DECLARE v_company uuid; v_bound uuid; v_now timestamptz := transaction_timestamp();
BEGIN
 IF p_code_digest IS NULL OR p_code_digest !~ '^[a-f0-9]{64}$' OR
    p_site_id IS NULL OR p_site_id !~ '^site-[a-f0-9]{24}$' OR
    p_secret IS NULL OR p_secret !~ '^[a-f0-9]{64}$'
 THEN RETURN NULL; END IF;
 UPDATE titan.tzfd_pairing_codes SET used_at=v_now
  WHERE code_digest=p_code_digest AND used_at IS NULL AND expires_at>v_now
  RETURNING company_uuid INTO v_company;
 IF v_company IS NULL THEN RETURN NULL; END IF;
 SELECT company_uuid INTO v_bound FROM titan.tzfd_site_secrets WHERE site_id=p_site_id FOR UPDATE;
 IF FOUND AND v_bound<>v_company THEN
  RAISE EXCEPTION 'tzfd site is bound to another company' USING ERRCODE='P0001';
 END IF;
 INSERT INTO titan.tzfd_site_secrets(site_id,company_uuid,secret,paired_at)
 VALUES(p_site_id,v_company,p_secret,v_now)
 ON CONFLICT(site_id) DO UPDATE SET secret=excluded.secret,paired_at=excluded.paired_at;
 RETURN v_company;
END $$;

REVOKE ALL ON FUNCTION titan.pair_tzfd_site(char,text,char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.pair_tzfd_site(char,text,char) TO titan_tzfd_pair;
GRANT CREATE ON SCHEMA titan TO titan_tzfd_pair_owner;
ALTER FUNCTION titan.pair_tzfd_site(char,text,char) OWNER TO titan_tzfd_pair_owner;
REVOKE CREATE ON SCHEMA titan FROM titan_tzfd_pair_owner;
COMMENT ON FUNCTION titan.pair_tzfd_site(char,text,char) IS
 'Consumes one unused, unexpired Front Desk pairing code and binds the site secret to its company, atomically, on the database clock. Returns NULL when the code is refused.';
COMMIT;
