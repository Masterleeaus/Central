-- Scheduled tenant isolation using the same canonical RLS reader as other products.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.companies(id,name) VALUES
 ('00000000-0000-4000-8000-000000000741','Scheduled Alpha'),
 ('00000000-0000-4000-8000-000000000742','Scheduled Beta');
INSERT INTO titan.identities(id,logto_subject) VALUES
 ('00000000-0000-4000-8000-000000000743','scheduled-alpha'),
 ('00000000-0000-4000-8000-000000000744','scheduled-beta');
INSERT INTO titan.company_memberships(company_id,identity_id,role) VALUES
 ('00000000-0000-4000-8000-000000000741','00000000-0000-4000-8000-000000000743','owner'),
 ('00000000-0000-4000-8000-000000000742','00000000-0000-4000-8000-000000000744','owner');
INSERT INTO titan.application_entitlements(company_id,application_id) VALUES
 ('00000000-0000-4000-8000-000000000741','scheduled'),
 ('00000000-0000-4000-8000-000000000742','scheduled');
INSERT INTO titan.application_company_links(company_id,application_id,local_company_id) VALUES
 ('00000000-0000-4000-8000-000000000741','scheduled','scheduled-alpha'),
 ('00000000-0000-4000-8000-000000000742','scheduled','scheduled-beta');
INSERT INTO titan.application_user_links(company_id,identity_id,application_id,local_user_id) VALUES
 ('00000000-0000-4000-8000-000000000741','00000000-0000-4000-8000-000000000743','scheduled','scheduled-alpha-user'),
 ('00000000-0000-4000-8000-000000000742','00000000-0000-4000-8000-000000000744','scheduled','scheduled-beta-user');
SET LOCAL ROLE titan_shared_company_reader;
DO $$
DECLARE table_name text; row_count integer;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['application_entitlements','application_company_links','application_user_links'] LOOP
  EXECUTE format('SELECT count(*) FROM titan.%I WHERE application_id = %L',table_name,'scheduled') INTO row_count;
  IF row_count<>0 THEN RAISE EXCEPTION 'Unscoped Scheduled % leaked % rows',table_name,row_count; END IF;
 END LOOP;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000741',true);
DO $$
DECLARE table_name text; row_count integer;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['application_entitlements','application_company_links','application_user_links'] LOOP
  EXECUTE format('SELECT count(*) FROM titan.%I WHERE application_id = %L',table_name,'scheduled') INTO row_count;
  IF row_count<>1 THEN RAISE EXCEPTION 'Alpha Scheduled % exposed % rows',table_name,row_count; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM titan.application_company_links WHERE local_company_id='scheduled-beta') THEN
  RAISE EXCEPTION 'Scheduled Beta company link leaked to Alpha'; END IF;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000742',true);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.application_user_links WHERE local_user_id='scheduled-alpha-user') THEN
  RAISE EXCEPTION 'Scheduled Alpha user link leaked after tenant switch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM titan.application_user_links WHERE local_user_id='scheduled-beta-user') THEN
  RAISE EXCEPTION 'Scheduled Beta user link missing'; END IF;
END $$;
-- A malformed tenant selector must fail closed for every Scheduled table.
SELECT set_config('titan.company_id','not-a-uuid',true);
DO $rls$
DECLARE table_name text; row_count integer;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['application_entitlements','application_company_links','application_user_links'] LOOP
  EXECUTE format('SELECT count(*) FROM titan.%I WHERE application_id = %L',table_name,'scheduled') INTO row_count;
  IF row_count<>0 THEN RAISE EXCEPTION 'Malformed Scheduled scope leaked % rows from %',row_count,table_name; END IF;
 END LOOP;
END $rls$;
-- The read-only role must not be able to mutate Scheduled registration records.
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000741',true);
DO $rls$
DECLARE table_name text; denied boolean;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['application_entitlements','application_company_links','application_user_links'] LOOP
  denied := false;
  BEGIN
   EXECUTE format('DELETE FROM titan.%I WHERE application_id = %L',table_name,'scheduled');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Scheduled reader can delete from %',table_name; END IF;
 END LOOP;
END $rls$;
RESET ROLE;
ROLLBACK;
\echo Scheduled tenant isolation passed
