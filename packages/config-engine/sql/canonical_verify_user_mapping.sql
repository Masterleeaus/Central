\set ON_ERROR_STOP on
DO $$ BEGIN IF (SELECT count(*) FROM titan.application_user_links WHERE local_user_id='legacy-user-a')<>1 THEN RAISE EXCEPTION 'canonical user mapping missing';END IF; END $$;
