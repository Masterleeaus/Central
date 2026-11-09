\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_company_authority_reader;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM titan.companies c
 JOIN titan.company_memberships m ON m.company_id=c.id
 JOIN titan.identities i ON i.id=m.identity_id
 JOIN titan.application_entitlements e ON e.company_id=c.id
 WHERE c.id='550e8400-e29b-41d4-a716-446655440000' AND c.status='active' AND i.logto_subject='operator_a'
 AND i.status='active' AND m.status='active' AND m.role='owner'
 AND e.status='active' AND e.application_id='central')
 THEN RAISE EXCEPTION 'active canonical owner not found';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
