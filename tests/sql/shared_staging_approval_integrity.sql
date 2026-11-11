-- Disposable canonical staging integrity tests after real issuer + executor runs.
\set ON_ERROR_STOP on
DO $$
DECLARE result record; msg text;
BEGIN
 SELECT * INTO result FROM titan.verify_staging_backfill_integrity();
 IF result.approvals_checked < 5 OR result.audits_checked < 4
    OR result.mismatched_approvals<>0 OR result.mismatched_audits<>0
    OR result.missing_success_events<>0
 THEN RAISE EXCEPTION 'initial staging approval and event integrity incorrect'; END IF;

 BEGIN
  UPDATE titan.staging_backfill_approvals SET membership_role='owner'
   WHERE approval_id='00000000-0000-4000-8000-000000000705';
  RAISE EXCEPTION 'immutable approval fields could be rewritten';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'staging approval immutable content changed' THEN RAISE; END IF;
 END;

 BEGIN
  UPDATE titan.staging_backfill_audit SET executing_login='imposter'
   WHERE approval_id='00000000-0000-4000-8000-000000000705';
  RAISE EXCEPTION 'immutable audit event could be changed';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'staging audit row immutable' THEN RAISE; END IF;
 END;

 BEGIN
  DELETE FROM titan.staging_backfill_approvals
   WHERE approval_id='00000000-0000-4000-8000-000000000705';
  RAISE EXCEPTION 'approval deletion not rejected';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'staging approval deletion forbidden' THEN RAISE; END IF;
 END;

 BEGIN
  DELETE FROM titan.staging_backfill_audit
   WHERE approval_id='00000000-0000-4000-8000-000000000705';
  RAISE EXCEPTION 'audit deletion not rejected';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'staging audit row immutable' THEN RAISE; END IF;
 END;

 BEGIN
  UPDATE titan.staging_backfill_approvals SET consumed_at=clock_timestamp()
   WHERE approval_id='00000000-0000-4000-8000-000000000705';
  RAISE EXCEPTION 'second consumption mutation not rejected';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'invalid staging approval consumption transition' THEN RAISE; END IF;
 END;
END $$;
-- A privileged data rewrite that suppresses the trigger MUST be detected
-- by the separate aggregate verifier. Never leave the tamper in place.
BEGIN;
ALTER TABLE titan.staging_backfill_approvals
 DISABLE TRIGGER staging_approval_evidence_guard;
UPDATE titan.staging_backfill_approvals SET membership_role='owner'
 WHERE approval_id='00000000-0000-4000-8000-000000000705';
DO $$
DECLARE result record;
BEGIN
 SELECT * INTO result FROM titan.verify_staging_backfill_integrity();
 IF result.mismatched_approvals<>1 THEN
  RAISE EXCEPTION 'independent verifier failed to detect changed approval row';
 END IF;
END $$;
ROLLBACK;
DO $$
DECLARE result record;
BEGIN
 SELECT * INTO result FROM titan.verify_staging_backfill_integrity();
 IF result.mismatched_approvals<>0 OR result.mismatched_audits<>0
 OR result.missing_success_events<>0 THEN
  RAISE EXCEPTION 'transaction rollback did not restore approval fingerprints';
 END IF;
END $$;
\echo staging approval fingerprint guard, tamper detection and restoration passed
