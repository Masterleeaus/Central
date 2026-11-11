\set ON_ERROR_STOP on
DO $$ BEGIN IF (SELECT count(*) FROM titan.application_company_links WHERE local_company_id='legacy-company-a')<>1 THEN RAISE EXCEPTION 'canonical company mapping missing';END IF; END $$;
