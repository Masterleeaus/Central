-- Disposable SQL test for durable one-use company-selection storage.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.central_company_selection_states
(state_digest,binding_hash,sealed_issuer,sealed_subject,sealed_company_ids,expires_at)
VALUES(repeat('a',64),repeat('b',64),'sealed-issuer','sealed-subject','sealed-companies',now()+interval '5 minutes');
-- The schema disallows inserting expired rows. Simulate a request occurring
-- after expiry using a future clock bound against an otherwise valid row.
SET LOCAL ROLE titan_central_selection;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.central_company_selection_states WHERE state_digest=repeat('a',64);
 IF n<>1 THEN RAISE EXCEPTION 'Selection role cannot inspect pending state'; END IF;
 -- The application always binds the current clock to the expiring DELETE.
 DELETE FROM titan.central_company_selection_states
 WHERE state_digest=repeat('a',64) AND expires_at > now()+interval '10 minutes';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Expired selection consumed as live'; END IF;
 DELETE FROM titan.central_company_selection_states WHERE state_digest=repeat('a',64);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Expected atomic one-use consumption'; END IF;
 DELETE FROM titan.central_company_selection_states WHERE state_digest=repeat('a',64);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Selection state consumed twice'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE titan_trusted_reader;
DO $$
BEGIN
 BEGIN
  PERFORM * FROM titan.central_company_selection_states;
  RAISE EXCEPTION 'Reader unexpectedly accessed selection state';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE titan_tenant_app;
DO $$
BEGIN
 BEGIN
  PERFORM * FROM titan.central_company_selection_states;
  RAISE EXCEPTION 'Tenant unexpectedly accessed selection state';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
