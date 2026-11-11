-- Contract acceptance for Scheduled product ID in the canonical shared core.
-- Execute against a disposable DB after migrate_shared.py; leave no data.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO titan.companies (id, name)
VALUES ('00000000-0000-4000-8000-000000000731', 'Scheduled integration fixture');
INSERT INTO titan.identities (id, logto_subject)
VALUES ('00000000-0000-4000-8000-000000000732', 'scheduled-fixture-subject');

INSERT INTO titan.application_entitlements (company_id, application_id)
VALUES ('00000000-0000-4000-8000-000000000731', 'scheduled');
INSERT INTO titan.application_company_links (company_id, application_id, local_company_id)
VALUES ('00000000-0000-4000-8000-000000000731', 'scheduled', 'scheduled-fixture-company');
INSERT INTO titan.application_user_links (company_id, identity_id, application_id, local_user_id)
VALUES ('00000000-0000-4000-8000-000000000731',
        '00000000-0000-4000-8000-000000000732',
        'scheduled', 'scheduled-fixture-user');

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM titan.application_entitlements WHERE application_id='scheduled')
    OR NOT EXISTS (SELECT 1 FROM titan.application_company_links WHERE application_id='scheduled')
    OR NOT EXISTS (SELECT 1 FROM titan.application_user_links WHERE application_id='scheduled')
 THEN RAISE EXCEPTION 'Scheduled shared product registration failed'; END IF;
END $$;

-- Unsupported product identifiers must fail closed in every registration table.
-- PL/pgSQL exception subtransactions verify rejection without aborting the fixture.
DO $tag$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO titan.application_entitlements (company_id, application_id)
    VALUES ('00000000-0000-4000-8000-000000000731', 'unknown_product');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unknown entitlement product accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO titan.application_company_links (company_id, application_id, local_company_id)
    VALUES ('00000000-0000-4000-8000-000000000731', 'unknown_product', 'invalid-company');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unknown company-link product accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO titan.application_user_links (company_id, identity_id, application_id, local_user_id)
    VALUES ('00000000-0000-4000-8000-000000000731',
            '00000000-0000-4000-8000-000000000732', 'unknown_product', 'invalid-user');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unknown user-link product accepted'; END IF;
END $tag$;

-- Verify the migration's actual catalog constraints, not only its fixture inserts.
-- Every canonical registration table must have a validated CHECK mentioning Scheduled,
-- and legacy identifiers must remain accepted by the original contract.
DO $contract$
DECLARE
  table_name text;
  constraint_name text;
  expression text;
  validated boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'application_entitlements', 'application_company_links', 'application_user_links'
  ] LOOP
    constraint_name := table_name || '_application_id_check';
    SELECT pg_get_constraintdef(c.oid), c.convalidated
      INTO expression, validated
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'titan'
       AND t.relname = table_name
       AND c.conname = constraint_name
       AND c.contype = 'c';
    IF expression IS NULL OR NOT validated THEN
      RAISE EXCEPTION 'Missing or unvalidated product constraint on %', table_name;
    END IF;
    IF position('scheduled' in expression) = 0
       OR position('sorted' in expression) = 0
       OR position('lms' in expression) = 0
       OR position('supercharged' in expression) = 0 THEN
      RAISE EXCEPTION 'Product constraint on % lost a required product: %', table_name, expression;
    END IF;
  END LOOP;
END $contract$;

ROLLBACK;
\echo scheduled shared product registration checks passed
