-- Disposable verification of SECURITY DEFINER company discovery role.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.identities(id,logto_subject,state) VALUES
 ('00000000-0000-4000-8000-0000000000e1','company-discovery-verified','active'),
 ('00000000-0000-4000-8000-0000000000e2','company-discovery-revoked','active');
INSERT INTO titan.organisations(id,logto_organisation_id,state) VALUES
 ('00000000-0000-4000-8000-0000000000a1','discovery-org-A','active'),
 ('00000000-0000-4000-8000-0000000000b1','discovery-org-B','active');
INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES
 ('00000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000a1','owner','active'),
 ('00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000b1','owner','revoked'),
 ('00000000-0000-4000-8000-000000000c03','00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000b1','owner','active');
INSERT INTO titan.entitlements(id,organisation_id,application_id,state) VALUES
 ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000a1','field','active'),
 ('00000000-0000-4000-8000-000000000d02','00000000-0000-4000-8000-0000000000b1','desk','paused');
SET LOCAL ROLE titan_central_discovery;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.central_eligible_companies('company-discovery-verified');
 IF n <> 1 THEN RAISE EXCEPTION 'Expected only eligible company A, found %',n; END IF;
 SELECT count(*) INTO n FROM titan.central_eligible_companies('company-discovery-revoked');
 IF n <> 0 THEN RAISE EXCEPTION 'Revoked/paused company incorrectly disclosed'; END IF;
 SELECT count(*) INTO n FROM titan.central_eligible_companies('does-not-exist');
 IF n <> 0 THEN RAISE EXCEPTION 'Unknown subject must not return any companies'; END IF;
 BEGIN
  PERFORM * FROM titan.memberships;
  RAISE EXCEPTION 'Discovery role must not directly read memberships';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE titan.organisations SET state='suspended';
  RAISE EXCEPTION 'Discovery role must not mutate companies';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
-- Even the ordinary tenant read role must not execute cross-tenant discovery.
SET LOCAL ROLE titan_tenant_app;
DO $$
BEGIN
 BEGIN
  PERFORM * FROM titan.central_eligible_companies('company-discovery-verified');
  RAISE EXCEPTION 'Tenant role unexpectedly accessed discovery function';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
