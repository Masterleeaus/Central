-- Disposable PostgreSQL privilege and replay test for migration 0016.
-- No production endpoint; all proof fixtures rollback.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 IF has_table_privilege('titan_product_link_nonce','titan.product_link_proof_nonces','SELECT')
 OR has_table_privilege('titan_product_link_nonce','titan.product_link_proof_nonces','INSERT')
 OR has_table_privilege('titan_product_link_nonce','titan.product_link_proof_nonces','DELETE')
 OR has_table_privilege('titan_product_link_nonce','titan.product_link_proof_nonces','UPDATE')
 THEN RAISE EXCEPTION 'nonce invoker granted direct table access'; END IF;
 IF (SELECT pg_get_userbyid(proowner)
     FROM pg_proc WHERE oid='titan.claim_product_link_proof_nonce(text,character,timestamptz)'::regprocedure)
   <> 'titan_product_link_nonce_owner' THEN
  RAISE EXCEPTION 'nonce function owner not restricted'; END IF;
 IF (SELECT rolbypassrls FROM pg_roles WHERE rolname='titan_product_link_nonce_owner')
 OR has_schema_privilege('titan_product_link_nonce_owner','titan','CREATE')
 THEN RAISE EXCEPTION 'nonce function owner has excess privileges'; END IF;
END $$;
SET LOCAL ROLE titan_product_link_nonce;
DO $$
DECLARE first boolean;second boolean;other boolean;wrong boolean;
BEGIN
 SELECT titan.claim_product_link_proof_nonce(
  'field',repeat('a',64)::char(64),now()+interval '60 seconds') INTO first;
 SELECT titan.claim_product_link_proof_nonce(
  'field',repeat('a',64)::char(64),now()+interval '60 seconds') INTO second;
 SELECT titan.claim_product_link_proof_nonce(
  'desk',repeat('a',64)::char(64),now()+interval '60 seconds') INTO other;
 SELECT titan.claim_product_link_proof_nonce(
  'unknown',repeat('a',64)::char(64),now()+interval '60 seconds') INTO wrong;
 IF first IS DISTINCT FROM true OR second IS DISTINCT FROM false
 OR other IS DISTINCT FROM true OR wrong IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'nonce single-use/product separation failure'; END IF;
 BEGIN
  INSERT INTO titan.product_link_proof_nonces(application_id,nonce_digest,expires_at)
   VALUES('field',repeat('b',64),now()+interval '60 seconds');
  RAISE EXCEPTION 'unprivileged nonce insertion succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM titan.product_link_proof_nonces;
  RAISE EXCEPTION 'unprivileged nonce deletion succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.product_link_proof_nonces;
 IF n<>2 THEN RAISE EXCEPTION 'unexpected claimed nonce count %',n; END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.product_link_proof_nonces)
 THEN RAISE EXCEPTION 'nonce test persisted fixtures'; END IF;
END $$;
\echo product link nonce claim RLS, replay and rollback passed
