\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE product='central' AND key='ci_flag'
  AND kind='company' AND revision=1) NOT IN (0,2)
 THEN RAISE EXCEPTION 'unexpected E2E scope state'; END IF;
END $$;
