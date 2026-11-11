-- Disposable CI only: an independently authenticated NOINHERIT login.
-- Production must provision a dedicated staging login separately.
\set ON_ERROR_STOP on
CREATE ROLE titan_backfill_ci_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
 PASSWORD 'ci-only-throwaway';
GRANT titan_staging_backfill_executor TO titan_backfill_ci_login;
INSERT INTO titan.staging_backfill_approvals(
 approval_id,legacy_organisation_id,company_id,logto_organisation_id,
 identity_id,logto_subject,identity_status,membership_role,
 approved_by,change_ticket,expires_at
) VALUES(
 '00000000-0000-4000-8000-000000000705',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011','logto-company-a',
 '00000000-0000-4000-8000-000000000805','staging-real-login-subject',
 'active','member','staging-approver','CI-LOGIN-005',
 now()+interval '5 minutes'
);
