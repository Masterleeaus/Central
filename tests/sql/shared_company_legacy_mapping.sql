-- Integration contract for the safe legacy to canonical company mapping.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.companies(id,name) VALUES
 ('00000000-0000-4000-8000-000000000011','Canonical A'),
 ('00000000-0000-4000-8000-000000000022','Canonical B');
INSERT INTO titan.central_legacy_company_links(
 legacy_organisation_id,company_id,logto_organisation_id,status,verified_at) VALUES
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000011','logto-a','verified',now()),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-000000000022','logto-b','pending',NULL);
SET LOCAL ROLE titan_shared_company_reader;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000011',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.central_legacy_company_links;
 IF n<>1 THEN RAISE EXCEPTION 'verified link must be scoped to company A'; END IF;
 IF NOT EXISTS(SELECT 1 FROM titan.central_legacy_company_links
    WHERE legacy_organisation_id='00000000-0000-4000-8000-0000000000a1')
 THEN RAISE EXCEPTION 'verified legacy mapping missing'; END IF;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000022',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.central_legacy_company_links;
 IF n<>0 THEN RAISE EXCEPTION 'pending link gave company B authority'; END IF;
END $$;
SELECT set_config('titan.company_id','',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.central_legacy_company_links;
 IF n<>0 THEN RAISE EXCEPTION 'unscoped mapping disclosure'; END IF;
 BEGIN
  UPDATE titan.central_legacy_company_links SET status='verified';
  RAISE EXCEPTION 'reader can approve a legacy link';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
\echo legacy to canonical mapping isolation passed
