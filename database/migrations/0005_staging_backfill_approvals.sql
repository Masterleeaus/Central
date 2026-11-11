-- Staging-only, database-enforced one-use approval for a single identity/member
-- backfill. Install in canonical chain; function refuses all non-whitelisted DBs.
-- This is NOT a production migration function. NOLOGIN execution role must be
-- granted to a separately authenticated staging-only login by an administrator.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_staging_backfill_executor') THEN
  CREATE ROLE titan_staging_backfill_executor NOLOGIN NOINHERIT;
 END IF;
END $$;

CREATE TABLE titan.staging_backfill_approvals (
 approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 legacy_organisation_id uuid NOT NULL,
 company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
 logto_organisation_id text NOT NULL CHECK(length(btrim(logto_organisation_id))>0),
 identity_id uuid NOT NULL,
 logto_subject text NOT NULL CHECK(length(btrim(logto_subject))>0),
 identity_status text NOT NULL CHECK(identity_status='active'),
 membership_role text NOT NULL CHECK(membership_role IN ('owner','admin','manager','member','learner')),
 approved_by text NOT NULL CHECK(length(btrim(approved_by))>0),
 change_ticket text NOT NULL CHECK(length(btrim(change_ticket))>0),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE titan.staging_backfill_audit (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 approval_id uuid NOT NULL UNIQUE REFERENCES titan.staging_backfill_approvals(approval_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES titan.companies(id) ON DELETE RESTRICT,
 identity_id uuid NOT NULL REFERENCES titan.identities(id) ON DELETE RESTRICT,
 executing_login text NOT NULL,
 executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 result text NOT NULL CHECK(result='staging_committed')
);
-- No RLS policies for executor. The staging operator cannot inspect/write
-- approvals, identities, memberships or audit tables directly.
ALTER TABLE titan.staging_backfill_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.staging_backfill_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE titan.staging_backfill_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.staging_backfill_audit FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA titan TO titan_staging_backfill_executor;

CREATE FUNCTION titan.execute_staging_backfill_approval(p_approval_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog,titan
SET row_security = on
AS $$
DECLARE
 a titan.staging_backfill_approvals%ROWTYPE;
 event uuid;
BEGIN
 IF current_database() NOT IN ('titan_shared_ci','titan_shared_staging','titan_shared_backfill_ci') THEN
  RAISE EXCEPTION 'staging backfill prohibited in this database';
 END IF;
 -- Concurrent consumers of the same approval are serialized by row lock.
 SELECT * INTO a FROM titan.staging_backfill_approvals
 WHERE approval_id=p_approval_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'approval not found'; END IF;
 IF a.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'approval already consumed'; END IF;
 IF clock_timestamp()>=a.expires_at OR clock_timestamp()<a.created_at THEN
  RAISE EXCEPTION 'approval expired or invalid';
 END IF;
 -- Exact approved mapping, rechecked under an explicit lock against
 -- concurrent revocation and company suspension.
 PERFORM 1 FROM titan.central_legacy_company_links l
 JOIN titan.companies c ON c.id=l.company_id
 WHERE l.legacy_organisation_id=a.legacy_organisation_id
   AND l.company_id=a.company_id
   AND l.logto_organisation_id=a.logto_organisation_id
   AND l.status='verified' AND l.verified_at IS NOT NULL
   AND c.status='active'
 FOR SHARE OF l,c;
 IF NOT FOUND THEN RAISE EXCEPTION 'approved company mapping invalid'; END IF;
 IF EXISTS(SELECT 1 FROM titan.identities
   WHERE id=a.identity_id OR logto_subject=a.logto_subject) THEN
  RAISE EXCEPTION 'identity collision';
 END IF;
 INSERT INTO titan.identities(id,logto_subject,status)
 VALUES(a.identity_id,a.logto_subject,a.identity_status);
 INSERT INTO titan.company_memberships(company_id,identity_id,role,status)
 VALUES(a.company_id,a.identity_id,a.membership_role,'active');
 UPDATE titan.staging_backfill_approvals SET consumed_at=clock_timestamp()
 WHERE approval_id=a.approval_id;
 INSERT INTO titan.staging_backfill_audit(
   approval_id,company_id,identity_id,executing_login,result)
 VALUES(a.approval_id,a.company_id,a.identity_id,session_user,'staging_committed')
 RETURNING event_id INTO event;
 RETURN event;
END $$;
REVOKE ALL ON FUNCTION titan.execute_staging_backfill_approval(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.execute_staging_backfill_approval(uuid)
 TO titan_staging_backfill_executor;
COMMENT ON FUNCTION titan.execute_staging_backfill_approval(uuid) IS
 'Staging-only, one-use, SQL-bound approval: atomically creates one identity and membership and appends audit. No production execution.';
COMMIT;
