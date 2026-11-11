\set ON_ERROR_STOP on
DO $$ BEGIN IF (SELECT count(*) FROM titan.application_entitlements WHERE application_id='central' AND status='active')<>2 THEN RAISE EXCEPTION 'canonical entitlement mismatch';END IF; END $$;
