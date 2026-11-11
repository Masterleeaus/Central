\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('company_b','central','stage','550e8400-e29b-41d4-a716-446655440001','active');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_grant_reader;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan_config.service_company_grants g
 JOIN titan.companies c ON c.id=g.company_id WHERE g.client_id='company_b' AND c.status='active')
 THEN RAISE EXCEPTION 'suspended company allowed';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
