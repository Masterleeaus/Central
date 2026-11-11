-- Disposable reconciliation fixtures for the legacy Central database.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.organisations(id,logto_organisation_id,state) VALUES
 ('00000000-0000-4000-8000-000000000001','logto-company-a','active'),
 ('00000000-0000-4000-8000-000000000002','logto-company-b','active');
INSERT INTO titan.identities(id,logto_subject,state) VALUES
 ('00000000-0000-4000-8000-000000000101','audit-person-a','active'),
 ('00000000-0000-4000-8000-000000000102','audit-person-b','active');
INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','owner','active'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','member','active');
INSERT INTO titan.entitlements(id,organisation_id,application_id,state,features) VALUES
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','field','active',ARRAY['jobs']),
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000002','academy','trialing',ARRAY['courses']);
INSERT INTO titan.local_account_links(
 id,identity_id,organisation_id,application_id,local_user_id,local_account_id,state,verified_at) VALUES
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','field','field-a','account-a','verified',now()),
 ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','academy','lms-b','account-b','verified',now());
COMMIT;
