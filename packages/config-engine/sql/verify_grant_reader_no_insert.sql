\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_grant_reader;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
  VALUES('denied_service','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
  RAISE EXCEPTION 'reader mutation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
