-- Staging approval and commit-audit integrity. Forward-only: 0012.
-- Each row gets a canonical SHA-256 fingerprint of immutable content.
-- Approval rows may only transition consumed_at NULL -> not NULL.
-- Audit rows are append-only. Tamper checks work for ordinary DB roles;
-- they DO NOT protect against superusers or owners that rewrite triggers.
BEGIN;
ALTER TABLE titan.staging_backfill_approvals
 ADD COLUMN evidence_sha256 text;
ALTER TABLE titan.staging_backfill_audit
 ADD COLUMN evidence_sha256 text;

CREATE FUNCTION titan.staging_approval_fingerprint(
 p titan.staging_backfill_approvals)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog
AS $$
 SELECT encode(digest(
  jsonb_build_array(
   'titan.staging.approval.v1',
   p.approval_id::text,p.legacy_organisation_id::text,p.company_id::text,
   p.logto_organisation_id,p.identity_id::text,p.logto_subject,
   p.identity_status,p.membership_role,p.approved_by,p.change_ticket,
   to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
   to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')
  )::text::bytea,'sha256'),'hex')
$$;

CREATE FUNCTION titan.staging_audit_fingerprint(
 p titan.staging_backfill_audit)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog
AS $$
 SELECT encode(digest(
  jsonb_build_array(
   'titan.staging.audit.v1',
   p.event_id::text,p.approval_id::text,p.company_id::text,
   p.identity_id::text,p.executing_login,
   to_char(p.executed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
   p.result
  )::text::bytea,'sha256'),'hex')
$$;

CREATE FUNCTION titan.guard_staging_approval_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,titan
AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'staging approval deletion forbidden'; END IF;
 IF TG_OP='INSERT' THEN
   NEW.evidence_sha256:=titan.staging_approval_fingerprint(NEW);
   RETURN NEW;
 END IF;
 IF ROW(
   NEW.approval_id,NEW.legacy_organisation_id,NEW.company_id,
   NEW.logto_organisation_id,NEW.identity_id,NEW.logto_subject,
   NEW.identity_status,NEW.membership_role,NEW.approved_by,
   NEW.change_ticket,NEW.created_at,NEW.expires_at,
   NEW.evidence_sha256
 ) IS DISTINCT FROM ROW(
   OLD.approval_id,OLD.legacy_organisation_id,OLD.company_id,
   OLD.logto_organisation_id,OLD.identity_id,OLD.logto_subject,
   OLD.identity_status,OLD.membership_role,OLD.approved_by,
   OLD.change_ticket,OLD.created_at,OLD.expires_at,
   OLD.evidence_sha256
 ) THEN RAISE EXCEPTION 'staging approval immutable content changed'; END IF;
 IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
  OR NEW.consumed_at < OLD.created_at THEN
  RAISE EXCEPTION 'invalid staging approval consumption transition';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION titan.guard_staging_audit_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,titan
AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' THEN
   RAISE EXCEPTION 'staging audit row immutable';
 END IF;
 NEW.evidence_sha256:=titan.staging_audit_fingerprint(NEW);
 RETURN NEW;
END $$;

-- Preserve existing test/fixture history if a staging DB is upgraded.
UPDATE titan.staging_backfill_approvals a
 SET evidence_sha256=titan.staging_approval_fingerprint(a);
UPDATE titan.staging_backfill_audit a
 SET evidence_sha256=titan.staging_audit_fingerprint(a);
ALTER TABLE titan.staging_backfill_approvals
 ALTER COLUMN evidence_sha256 SET NOT NULL;
ALTER TABLE titan.staging_backfill_audit
 ALTER COLUMN evidence_sha256 SET NOT NULL;

CREATE TRIGGER staging_approval_evidence_guard
 BEFORE INSERT OR UPDATE OR DELETE ON titan.staging_backfill_approvals
 FOR EACH ROW EXECUTE FUNCTION titan.guard_staging_approval_evidence();
CREATE TRIGGER staging_audit_evidence_guard
 BEFORE INSERT OR UPDATE OR DELETE ON titan.staging_backfill_audit
 FOR EACH ROW EXECUTE FUNCTION titan.guard_staging_audit_evidence();

-- Run by an independent privileged auditing principal. Do not grant to
-- the staging issuer/executor. A digest is NOT a digital signature.
CREATE FUNCTION titan.verify_staging_backfill_integrity()
RETURNS TABLE(approvals_checked bigint,audits_checked bigint,
 mismatched_approvals bigint,mismatched_audits bigint,
 missing_success_events bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,titan
AS $$
 SELECT
 (SELECT count(*) FROM titan.staging_backfill_approvals),
 (SELECT count(*) FROM titan.staging_backfill_audit),
 (SELECT count(*) FROM titan.staging_backfill_approvals a
   WHERE a.evidence_sha256 IS DISTINCT FROM titan.staging_approval_fingerprint(a)),
 (SELECT count(*) FROM titan.staging_backfill_audit a
   WHERE a.evidence_sha256 IS DISTINCT FROM titan.staging_audit_fingerprint(a)),
 (SELECT count(*) FROM titan.staging_backfill_approvals a
   WHERE (a.consumed_at IS NOT NULL) <>
    EXISTS(SELECT 1 FROM titan.staging_backfill_audit e
     WHERE e.approval_id=a.approval_id))
$$;
REVOKE ALL ON FUNCTION titan.staging_approval_fingerprint(
 titan.staging_backfill_approvals) FROM PUBLIC;
REVOKE ALL ON FUNCTION titan.staging_audit_fingerprint(
 titan.staging_backfill_audit) FROM PUBLIC;
REVOKE ALL ON FUNCTION titan.guard_staging_approval_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION titan.guard_staging_audit_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION titan.verify_staging_backfill_integrity() FROM PUBLIC;
COMMENT ON FUNCTION titan.verify_staging_backfill_integrity() IS
 'Privileged read-only aggregate verification of immutable approval and audit fingerprints; hashes are not independently signed.';
COMMIT;
