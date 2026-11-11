\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('ambiguous_client','central','stage','550e8400-e29b-41d4-a716-446655440000','active'),
('ambiguous_client','central','stage','550e8400-e29b-41d4-a716-446655440001','active');
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.service_company_grants WHERE client_id='ambiguous_client')<>2
 THEN RAISE EXCEPTION 'ambiguous fixture failed';END IF;
END $$;
ROLLBACK;
