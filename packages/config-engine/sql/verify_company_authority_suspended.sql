\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_company_authority_reader;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.companies c
 JOIN titan.company_memberships m ON m.company_id=c.id
 JOIN titan.identities i ON i.id=m.identity_id
 WHERE c.id='550e8400-e29b-41d4-a716-446655440001' AND c.status='active' AND i.logto_subject='operator_b')
 THEN RAISE EXCEPTION 'suspended company accepted';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
