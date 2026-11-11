-- Dedicated product selection durable-state role isolation and one-use expiry.
-- All test records are disposable and restored on ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.product_company_selection_states(
 application_id,state_digest,binding_hash,sealed_issuer,sealed_subject,
 sealed_company_ids,expires_at)
VALUES ('field',repeat('a',64),repeat('b',64),'sealed','sealed','sealed',now()+interval '5 minutes'),
 ('desk',repeat('a',64),repeat('b',64),'sealed','sealed','sealed',now()+interval '5 minutes');
INSERT INTO titan.product_company_selection_states(
 application_id,state_digest,binding_hash,sealed_issuer,sealed_subject,
 sealed_company_ids,created_at,expires_at)
VALUES('field',repeat('c',64),repeat('d',64),'sealed','sealed','sealed',
 now()-interval '6 minutes',now()-interval '1 minute');
DO $$
BEGIN
 IF has_table_privilege('titan_trusted_reader','titan.product_company_selection_states','SELECT')
 OR has_table_privilege('titan_tenant_app','titan.product_company_selection_states','SELECT')
 OR has_table_privilege('titan_product_link_nonce','titan.product_company_selection_states','SELECT')
 THEN RAISE EXCEPTION 'unrelated role has product selection access'; END IF;
END $$;
SET LOCAL ROLE titan_product_selection_field;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.product_company_selection_states
 WHERE state_digest=repeat('a',64);
 IF n<>1 THEN RAISE EXCEPTION 'foreign application selection visible'; END IF;
 DELETE FROM titan.product_company_selection_states
 WHERE application_id='field' AND state_digest=repeat('a',64)
 AND expires_at>now();
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'product state not consumed exactly once'; END IF;
 DELETE FROM titan.product_company_selection_states
 WHERE application_id='field' AND state_digest=repeat('a',64)
 AND expires_at>now();
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'product state consumed twice'; END IF;
 DELETE FROM titan.product_company_selection_states
 WHERE application_id='field' AND state_digest=repeat('c',64)
 AND expires_at>now();
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'expired product state accepted'; END IF;
 SELECT count(*) INTO n FROM titan.product_company_selection_states
 WHERE application_id='desk' AND state_digest=repeat('a',64);
 IF n<>0 THEN RAISE EXCEPTION 'other product selection visible to field role'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE titan_product_selection_desk;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.product_company_selection_states;
 IF n<>1 THEN RAISE EXCEPTION 'desk role could inspect other products'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.product_company_selection_states;
 IF n<>2 THEN RAISE EXCEPTION 'selection fixture count after one-use mismatch'; END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.product_company_selection_states)
 THEN RAISE EXCEPTION 'product company test left committed fixtures'; END IF;
END $$;
\echo per-product company selection replay, expiry, RLS and rollback verified
