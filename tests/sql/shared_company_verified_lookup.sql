\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.companies(id,name,status) VALUES
 ('00000000-0000-4000-8000-000000000011','Canonical & Co','active'),
 ('00000000-0000-4000-8000-000000000022','Pending Ltd','active');
INSERT INTO titan.central_legacy_company_links(
 legacy_organisation_id,company_id,logto_organisation_id,status,verified_at) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','logto-1','verified',now()),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022','logto-2','pending',NULL);
SET LOCAL ROLE titan_shared_company_reader;
DO $$
DECLARE resolved uuid; n int;
BEGIN
 SELECT titan.resolve_verified_central_company(
   '00000000-0000-4000-8000-000000000001','logto-1') INTO resolved;
 IF resolved IS DISTINCT FROM '00000000-0000-4000-8000-000000000011'::uuid THEN
  RAISE EXCEPTION 'verified mapping failed'; END IF;
 SELECT titan.resolve_verified_central_company(
   '00000000-0000-4000-8000-000000000001','spoofed-logto') INTO resolved;
 IF resolved IS NOT NULL THEN RAISE EXCEPTION 'mismatched Logto identifier mapped'; END IF;
 SELECT titan.resolve_verified_central_company(
   '00000000-0000-4000-8000-000000000002','logto-2') INTO resolved;
 IF resolved IS NOT NULL THEN RAISE EXCEPTION 'pending link mapped'; END IF;
 SELECT count(*) INTO n FROM titan.companies;
 IF n<>0 THEN RAISE EXCEPTION 'global company table leaked without scope'; END IF;
END $$;
SELECT set_config('titan.company_id','00000000-0000-4000-8000-000000000011',true);
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.companies WHERE name='Canonical & Co';
 IF n<>1 THEN RAISE EXCEPTION 'canonical company read failed under selected scope'; END IF;
 SELECT count(*) INTO n FROM titan.companies WHERE name='Pending Ltd';
 IF n<>0 THEN RAISE EXCEPTION 'other company name leaked'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo verified canonical name resolution passed
