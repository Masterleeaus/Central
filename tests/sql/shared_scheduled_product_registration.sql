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
-- A savepoint lets us assert the constraint error without aborting the fixture.
DO $
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
END $;

ROLLBACK;
\echo scheduled shared product registration checks passed
