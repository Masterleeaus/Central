\set ON_ERROR_STOP on
DO $$ BEGIN IF (SELECT count(*) FROM titan.companies WHERE status='active')<>2 THEN RAISE EXCEPTION 'canonical company data incomplete';END IF; END $$;
