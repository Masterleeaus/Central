-- Contract checks for database/migrations/0001_shared_company_core.sql.
-- Run only against a clean, disposable Titan shared-core database.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_table_name text;
  required_tables text[] := ARRAY[
    'companies', 'identities', 'company_memberships', 'application_entitlements',
    'application_company_links', 'application_user_links', 'schema_migrations'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY required_tables LOOP
    IF to_regclass(format('titan.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'missing shared-core table: titan.%', v_table_name;
    END IF;
  END LOOP;

  FOREACH v_table_name IN ARRAY ARRAY[
    'company_memberships', 'application_entitlements',
    'application_company_links', 'application_user_links'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS c
      WHERE c.table_schema='titan' AND c.table_name=v_table_name
        AND c.column_name='company_id' AND c.is_nullable='NO' AND c.udt_name='uuid'
    ) THEN
      RAISE EXCEPTION 'company-owned table lacks required company_id UUID: titan.%', v_table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON (tc.constraint_catalog,tc.constraint_schema,tc.constraint_name) =
           (kcu.constraint_catalog,kcu.constraint_schema,kcu.constraint_name)
      JOIN information_schema.constraint_column_usage ccu
        ON (tc.constraint_catalog,tc.constraint_schema,tc.constraint_name) =
           (ccu.constraint_catalog,ccu.constraint_schema,ccu.constraint_name)
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='titan'
        AND tc.table_name=v_table_name AND kcu.column_name='company_id'
        AND ccu.table_schema='titan' AND ccu.table_name='companies' AND ccu.column_name='id'
    ) THEN
      RAISE EXCEPTION 'company_id does not reference titan.companies(id): titan.%', v_table_name;
    END IF;
  END LOOP;
END $$;

INSERT INTO titan.companies (id,name) VALUES
  ('00000000-0000-4000-8000-000000000001','Company A'),
  ('00000000-0000-4000-8000-000000000002','Company B');
INSERT INTO titan.identities (id,logto_subject) VALUES
  ('00000000-0000-4000-8000-000000000101','ci-subject');
INSERT INTO titan.company_memberships (id,company_id,identity_id,role) VALUES
  ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','owner');
INSERT INTO titan.application_entitlements (company_id,application_id) VALUES
  ('00000000-0000-4000-8000-000000000001','sorted'),
  ('00000000-0000-4000-8000-000000000001','supercharged'),
  ('00000000-0000-4000-8000-000000000001','lms');
INSERT INTO titan.application_company_links (company_id,application_id,local_company_id) VALUES
  ('00000000-0000-4000-8000-000000000001','lms','legacy-lms-company');
INSERT INTO titan.application_user_links (company_id,identity_id,application_id,local_user_id) VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','lms','legacy-lms-user');

DO $$
BEGIN
  IF (SELECT count(DISTINCT application_id) FROM titan.application_entitlements) <> 3 THEN
    RAISE EXCEPTION 'expected all three canonical products in the shared entitlement core';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM titan.application_user_links WHERE application_id='lms') THEN
    RAISE EXCEPTION 'LMS canonical application ID is missing';
  END IF;
END $$;

ROLLBACK;
\echo shared company core migration checks passed
