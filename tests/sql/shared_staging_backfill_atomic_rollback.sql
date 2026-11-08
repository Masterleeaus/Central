-- A successful staging function call must be transactional, including
-- approval consumption and audit: an outer ROLLBACK restores everything.
\set ON_ERROR_STOP on
INSERT INTO titan.staging_backfill_approvals(
 approval_id,legacy_organisation_id,company_id,logto_organisation_id,
 identity_id,logto_subject,identity_status,membership_role,
 approved_by,change_ticket,expires_at
) VALUES (
 '00000000-0000-4000-8000-000000000704',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011','logto-company-a',
 '00000000-0000-4000-8000-000000000804','staging-rollback-subject',
 'active','member','staging-approver','CI-ROLLBACK-004',
 now()+interval '5 minutes'
);
BEGIN;
SET LOCAL ROLE titan_staging_backfill_executor;
SELECT titan.execute_staging_backfill_approval(
 '00000000-0000-4000-8000-000000000704');
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.identities
    WHERE id='00000000-0000-4000-8000-000000000804')
 OR EXISTS(SELECT 1 FROM titan.company_memberships
    WHERE identity_id='00000000-0000-4000-8000-000000000804')
 OR EXISTS(SELECT 1 FROM titan.staging_backfill_audit
    WHERE approval_id='00000000-0000-4000-8000-000000000704')
 OR EXISTS(SELECT 1 FROM titan.staging_backfill_approvals
    WHERE approval_id='00000000-0000-4000-8000-000000000704'
      AND consumed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'outer rollback did not revert all staging changes'; END IF;
END $$;

-- After rollback, the same approval is still valid, proving atomicity.
BEGIN;
SET LOCAL ROLE titan_staging_backfill_executor;
SELECT titan.execute_staging_backfill_approval(
 '00000000-0000-4000-8000-000000000704');
COMMIT;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM titan.staging_backfill_audit
 WHERE approval_id='00000000-0000-4000-8000-000000000704')
 OR NOT EXISTS(SELECT 1 FROM titan.staging_backfill_approvals
 WHERE approval_id='00000000-0000-4000-8000-000000000704'
  AND consumed_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM titan.company_memberships
 WHERE identity_id='00000000-0000-4000-8000-000000000804')
 THEN RAISE EXCEPTION 'successful retried transaction incomplete'; END IF;
END $$;
\echo staging approval, identity, membership and audit atomic rollback verified
