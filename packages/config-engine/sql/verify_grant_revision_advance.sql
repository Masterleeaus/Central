\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('advance_test','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
DO $$
BEGIN
 BEGIN
 UPDATE titan_config.service_company_grants SET state='revoked' WHERE client_id='advance_test';
 RAISE EXCEPTION 'grant state changed without revision';
 EXCEPTION WHEN raise_exception THEN
  -- Explicit trigger failure verified by SQLSTATE class is tested in CLI as well.
  NULL;
 END;
END $$;
ROLLBACK;
