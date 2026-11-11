\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
 VALUES('duplicate_service','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
   VALUES('duplicate_service','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
  RAISE EXCEPTION 'duplicate grant accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
