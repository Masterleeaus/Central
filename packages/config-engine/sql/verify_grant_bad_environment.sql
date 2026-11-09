\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
  VALUES('service_test','central','bad environment','550e8400-e29b-41d4-a716-446655440000','active');
  RAISE EXCEPTION 'invalid bad_environment accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
