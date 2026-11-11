\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('company_a','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.service_company_grants g
 JOIN titan.companies c ON c.id=g.company_id WHERE g.client_id='company_a' AND c.status='active')<>1
 THEN RAISE EXCEPTION 'active-company lookup failed';END IF;
END $$;
ROLLBACK;
