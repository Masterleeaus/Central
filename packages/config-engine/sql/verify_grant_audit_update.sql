\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
VALUES('audit_update','central','stage','550e8400-e29b-41d4-a716-446655440000','active');
UPDATE titan_config.service_company_grants SET state='revoked',revision=2 WHERE client_id='audit_update';
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.service_grant_audit a JOIN titan_config.service_company_grants g
 ON a.grant_id=g.id WHERE g.client_id='audit_update')<>2 THEN
 RAISE EXCEPTION 'grant transition not audited';END IF;
END $$;
ROLLBACK;
