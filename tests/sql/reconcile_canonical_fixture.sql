-- Disposable reconciliation fixtures for the canonical shared database.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.companies(id,name,status) VALUES
 ('00000000-0000-4000-8000-000000000011','Canonical A','active'),
 ('00000000-0000-4000-8000-000000000012','Canonical B','active');
INSERT INTO titan.identities(id,logto_subject,status) VALUES
 ('00000000-0000-4000-8000-000000000111','audit-person-a','active'),
 ('00000000-0000-4000-8000-000000000112','audit-person-b','active');
INSERT INTO titan.central_legacy_company_links(legacy_organisation_id,company_id,logto_organisation_id,status,verified_at) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','logto-company-a','verified',now()),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012','logto-company-b','verified',now());
INSERT INTO titan.company_memberships(identity_id,company_id,role,status) VALUES
 ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000011','owner','active'),
 ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000012','member','active');
INSERT INTO titan.application_entitlements(company_id,application_id,status,features) VALUES
 ('00000000-0000-4000-8000-000000000011','sorted','active',ARRAY['jobs']),
 ('00000000-0000-4000-8000-000000000012','lms','trialing',ARRAY['courses']);
INSERT INTO titan.application_user_links(identity_id,company_id,application_id,local_user_id,status) VALUES
 ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000011','sorted','field-a','verified'),
 ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000012','lms','lms-b','verified');
COMMIT;
