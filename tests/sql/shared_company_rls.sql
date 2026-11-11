-- Canonical shared-company RLS check. Run after 0001 and 0002 in
-- disposable titan_shared_ci database. All fixture writes rolled back.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.companies(id,name) VALUES
 ('00000000-0000-4000-8000-000000000001','Alpha'),
 ('00000000-0000-4000-8000-000000000002','Beta');
INSERT INTO titan.identities(id,logto_subject) VALUES
 ('00000000-0000-4000-8000-000000000101','shared-alpha'),
 ('00000000-0000-4000-8000-000000000102','shared-beta');
INSERT INTO titan.company_memberships(company_id,identity_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','owner'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','member');
INSERT INTO titan.application_entitlements(company_id,application_id) VALUES
 ('00000000-0000-4000-8000-000000000001','sorted'),
 ('00000000-0000-4000-8000-000000000002','lms');
INSERT INTO titan.application_company_links(company_id,application_id,local_company_id) VALUES
 ('00000000-0000-4000-8000-000000000001','sorted','legacy-alpha'),
 ('00000000-0000-4000-8000-000000000002','lms','legacy-beta');
INSERT INTO titan.application_user_links(company_id,identity_id,application_id,local_user_id) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','sorted','alpha-user'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','lms','beta-user');
SET LOCAL ROLE titan_shared_company_reader;
DO $$
DECLARE t text; n int;
BEGIN
 FOREACH t IN ARRAY ARRAY['companies','identities','company_memberships',
  'application_entitlements','application_company_links','application_user_links'] LOOP
  EXECUTE format('SELECT count(*) FROM titan.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'unscoped % leaked % rows',t,n; END IF;
 END LOOP;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE t text; n int;
BEGIN
 FOREACH t IN ARRAY ARRAY['companies','identities','company_memberships',
  'application_entitlements','application_company_links','application_user_links'] LOOP
  EXECUTE format('SELECT count(*) FROM titan.%I',t) INTO n;
  IF n<>1 THEN RAISE EXCEPTION 'Alpha % unexpectedly exposed % rows',t,n; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM titan.companies WHERE name='Beta') THEN
  RAISE EXCEPTION 'foreign company exposed'; END IF;
 IF EXISTS(SELECT 1 FROM titan.identities WHERE logto_subject='shared-beta') THEN
  RAISE EXCEPTION 'foreign identity exposed'; END IF;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.companies WHERE name='Alpha';
 IF n<>0 THEN RAISE EXCEPTION 'company switch retained Alpha access'; END IF;
 SELECT count(*) INTO n FROM titan.application_user_links WHERE local_user_id='beta-user';
 IF n<>1 THEN RAISE EXCEPTION 'Beta scoped user link unavailable'; END IF;
END $$;
SELECT set_config('titan.company_id','not-a-uuid',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.companies;
 IF n<>0 THEN RAISE EXCEPTION 'malformed tenant scope leaked company'; END IF;
 BEGIN
  UPDATE titan.companies SET name='forbidden';
  RAISE EXCEPTION 'reader was allowed to mutate company';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
\echo canonical company RLS passed
