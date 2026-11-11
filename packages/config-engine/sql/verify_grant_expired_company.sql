\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state,expires_at)
VALUES('expired_client','central','stage','550e8400-e29b-41d4-a716-446655440000','active',now()-interval '1 day');
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan_config.service_company_grants WHERE client_id='expired_client'
 AND state='active' AND (expires_at IS NULL OR expires_at>now()))
 THEN RAISE EXCEPTION 'expired grant survived active filter'; END IF;
END $$;
ROLLBACK;
