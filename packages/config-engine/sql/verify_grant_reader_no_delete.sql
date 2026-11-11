\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_grant_reader;
DO $$
BEGIN
 BEGIN
  DELETE FROM titan_config.service_company_grants;
  RAISE EXCEPTION 'grant reader delete accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
