\set ON_ERROR_STOP on
BEGIN;
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_company_authority_reader;
DO $$
BEGIN
 BEGIN
  UPDATE titan.company_memberships SET role='owner' WHERE role='admin';
  RAISE EXCEPTION 'restricted authority role can mutate memberships';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
