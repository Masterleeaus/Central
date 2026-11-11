\set ON_ERROR_STOP on
DO $$ BEGIN IF (SELECT count(*) FROM titan.company_memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject='operator_a' AND m.role='owner')<>1 THEN RAISE EXCEPTION 'canonical membership mismatch';END IF; END $$;
