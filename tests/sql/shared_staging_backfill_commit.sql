-- Disposable canonical staging-only integration test. Approval records are
-- inserted by the privileged test fixture, not by the staging executor.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.staging_backfill_approvals(
 approval_id,legacy_organisation_id,company_id,logto_organisation_id,
 identity_id,logto_subject,identity_status,membership_role,
 approved_by,change_ticket,expires_at
) VALUES
 ('00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011','logto-company-a',
  '00000000-0000-4000-8000-000000000801','staging-ledger-subject',
  'active','member','approved-staging-operator','CI-EXPLICIT-001',
  now()+interval '5 minutes'),
 ('00000000-0000-4000-8000-000000000702',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000012','logto-company-wrong',
  '00000000-0000-4000-8000-000000000802','staging-wrong-company-subject',
  'active','owner','approved-staging-operator','CI-EXPLICIT-002',
  now()+interval '5 minutes'),
 ('00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011','logto-company-a',
  '00000000-0000-4000-8000-000000000803','staging-expired-subject',
  'active','member','approved-staging-operator','CI-EXPLICIT-003',
  now()+interval '1 minute');
UPDATE titan.staging_backfill_approvals
 SET created_at=now()-interval '20 minutes',
     expires_at=now()-interval '10 minutes'
 WHERE approval_id='00000000-0000-4000-8000-000000000703';
COMMIT;

DO $$
BEGIN
 IF has_table_privilege('titan_staging_backfill_executor','titan.identities','INSERT')
 OR has_table_privilege('titan_staging_backfill_executor','titan.company_memberships','INSERT')
 OR has_table_privilege('titan_staging_backfill_executor','titan.staging_backfill_approvals','INSERT')
 OR has_table_privilege('titan_staging_backfill_executor','titan.staging_backfill_audit','INSERT')
 OR has_table_privilege('titan_staging_backfill_executor','titan.staging_backfill_approvals','SELECT')
 THEN RAISE EXCEPTION 'staging role has forbidden direct access'; END IF;
 IF NOT has_function_privilege('titan_staging_backfill_executor',
   'titan.execute_staging_backfill_approval(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'staging role missing exact function execute grant'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
  WHERE p.oid='titan.execute_staging_backfill_approval(uuid)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
 ) THEN RAISE EXCEPTION 'public can execute staging backfill'; END IF;
END $$;

-- Superuser CI can switch to a NOLOGIN group role; production logins must
-- get role membership explicitly and separately (never by this migration).
SET ROLE titan_staging_backfill_executor;
SELECT titan.execute_staging_backfill_approval(
 '00000000-0000-4000-8000-000000000701');
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  PERFORM titan.execute_staging_backfill_approval(
    '00000000-0000-4000-8000-000000000701');
  RAISE EXCEPTION 'replay did not reject';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'approval already consumed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM titan.execute_staging_backfill_approval(
    '00000000-0000-4000-8000-000000000702');
  RAISE EXCEPTION 'mismatched company mapping accepted';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'approved company mapping invalid' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM titan.execute_staging_backfill_approval(
    '00000000-0000-4000-8000-000000000703');
  RAISE EXCEPTION 'expired approval accepted';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'approval expired or invalid' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.identities
 WHERE id='00000000-0000-4000-8000-000000000801';
 IF n<>1 THEN RAISE EXCEPTION 'staging identity not committed'; END IF;
 SELECT count(*) INTO n FROM titan.company_memberships
 WHERE company_id='00000000-0000-4000-8000-000000000011'
 AND identity_id='00000000-0000-4000-8000-000000000801'
 AND role='member' AND status='active';
 IF n<>1 THEN RAISE EXCEPTION 'staging membership not committed'; END IF;
 SELECT count(*) INTO n FROM titan.staging_backfill_audit
 WHERE approval_id='00000000-0000-4000-8000-000000000701'
 AND identity_id='00000000-0000-4000-8000-000000000801'
 AND result='staging_committed';
 IF n<>1 THEN RAISE EXCEPTION 'audit event missing'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM titan.staging_backfill_approvals
  WHERE approval_id='00000000-0000-4000-8000-000000000701'
  AND consumed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'approval consumption not persisted'; END IF;
 IF EXISTS(SELECT 1 FROM titan.identities
  WHERE id IN ('00000000-0000-4000-8000-000000000802',
               '00000000-0000-4000-8000-000000000803'))
 THEN RAISE EXCEPTION 'rejected approval partially persisted'; END IF;
 SELECT count(*) INTO n FROM titan.staging_backfill_audit;
 IF n<>1 THEN RAISE EXCEPTION 'rejected approval recorded an audit commit'; END IF;
END $$;
\echo staging-only one-use committed backfill audit and replay prevention passed
