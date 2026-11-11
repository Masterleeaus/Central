\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_company_authority_reader;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.application_entitlements
 WHERE company_id='550e8400-e29b-41d4-a716-446655440000' AND application_id='sorted' AND status='active')
 THEN RAISE EXCEPTION 'ungranted product entitlement';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
