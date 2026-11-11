\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('fk_delete','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
DO $$
BEGIN
 BEGIN
 DELETE FROM titan.companies WHERE id='550e8400-e29b-41d4-a716-446655440000';
 RAISE EXCEPTION 'referenced company deleted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
ROLLBACK;
