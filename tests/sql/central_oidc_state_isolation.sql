-- Disposable PostgreSQL verification after migration 0010.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.titan_oidc_login_states
(application_id,state_digest,nonce,code_verifier,binding_hash,expires_at)
VALUES
('central',repeat('a',64),'sealed-a','sealed-a','hash-a',now()+interval '5 minutes'),
('field',repeat('b',64),'sealed-b','sealed-b','hash-b',now()+interval '5 minutes');
SET LOCAL ROLE titan_central_oidc;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.titan_oidc_login_states;
 IF n <> 1 THEN RAISE EXCEPTION 'Central OIDC role must only see central state'; END IF;
 DELETE FROM titan.titan_oidc_login_states WHERE application_id='field';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'Central role deleted foreign product state'; END IF;
 DELETE FROM titan.titan_oidc_login_states WHERE application_id='central';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 1 THEN RAISE EXCEPTION 'Central role cannot consume own state'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE titan_trusted_writer;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.titan_oidc_login_states;
 IF n <> 1 THEN RAISE EXCEPTION 'Product writer unexpectedly sees central state'; END IF;
 DELETE FROM titan.titan_oidc_login_states WHERE application_id='central';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'Product writer deleted central state'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE titan_trusted_reader;
DO $$
BEGIN
 BEGIN
  PERFORM * FROM titan.titan_oidc_login_states;
  RAISE EXCEPTION 'Reader improperly accessed OIDC state';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
