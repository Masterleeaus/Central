-- Staging privilege hardening. Do not modify historical checksum-locked 0005.
-- Two distinct NOLOGIN function owners with narrowly granted table rights.
-- Two distinct NOLOGIN invoker roles: approver cannot execute backfill,
-- executor cannot issue approvals. No login membership is granted here.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_staging_approval_owner') THEN
   CREATE ROLE titan_staging_approval_owner NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_staging_backfill_owner') THEN
   CREATE ROLE titan_staging_backfill_owner NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_staging_approval_issuer') THEN
   CREATE ROLE titan_staging_approval_issuer NOLOGIN NOINHERIT;
 END IF;
END $$;

GRANT USAGE ON SCHEMA titan TO titan_staging_backfill_owner,
 titan_staging_approval_owner,titan_staging_approval_issuer;
-- Exact grants; neither definer owns tenant data tables.
GRANT SELECT ON titan.companies,titan.central_legacy_company_links
 TO titan_staging_backfill_owner,titan_staging_approval_owner;
GRANT SELECT,INSERT ON titan.identities,titan.company_memberships
 TO titan_staging_backfill_owner;
GRANT SELECT,UPDATE ON titan.staging_backfill_approvals
 TO titan_staging_backfill_owner;
GRANT INSERT ON titan.staging_backfill_audit TO titan_staging_backfill_owner;
GRANT INSERT ON titan.staging_backfill_approvals TO titan_staging_approval_owner;

-- With FORCE RLS, the narrowly scoped function-owning roles need
-- explicit table policies. No policy gives a LOGIN or invoker direct DML.
CREATE POLICY staging_writer_company_read ON titan.companies
 FOR SELECT TO titan_staging_backfill_owner,titan_staging_approval_owner
 USING (status='active');
CREATE POLICY staging_writer_link_read ON titan.central_legacy_company_links
 FOR SELECT TO titan_staging_backfill_owner,titan_staging_approval_owner
 USING (status='verified' AND verified_at IS NOT NULL);
CREATE POLICY staging_writer_identity_read ON titan.identities
 FOR SELECT TO titan_staging_backfill_owner USING(true);
CREATE POLICY staging_writer_identity_create ON titan.identities
 FOR INSERT TO titan_staging_backfill_owner WITH CHECK(status='active');
CREATE POLICY staging_writer_member_read ON titan.company_memberships
 FOR SELECT TO titan_staging_backfill_owner USING(true);
CREATE POLICY staging_writer_member_create ON titan.company_memberships
 FOR INSERT TO titan_staging_backfill_owner WITH CHECK(status='active');
CREATE POLICY staging_writer_approval_read ON titan.staging_backfill_approvals
 FOR SELECT TO titan_staging_backfill_owner USING(true);
CREATE POLICY staging_writer_approval_consume ON titan.staging_backfill_approvals
 FOR UPDATE TO titan_staging_backfill_owner
 USING(consumed_at IS NULL) WITH CHECK(consumed_at IS NOT NULL);
CREATE POLICY staging_writer_approval_create ON titan.staging_backfill_approvals
 FOR INSERT TO titan_staging_approval_owner
 WITH CHECK(consumed_at IS NULL AND approved_by=session_user
   AND expires_at>created_at AND expires_at<=created_at+interval '15 minutes');
CREATE POLICY staging_writer_audit_create ON titan.staging_backfill_audit
 FOR INSERT TO titan_staging_backfill_owner WITH CHECK(
 result='staging_committed' AND executing_login=session_user);

-- PostgreSQL requires the new owner to have CREATE on the function schema
-- for an ALTER FUNCTION OWNER transfer. Never leave schema CREATE granted.
GRANT CREATE ON SCHEMA titan TO titan_staging_backfill_owner;
ALTER FUNCTION titan.execute_staging_backfill_approval(uuid)
 OWNER TO titan_staging_backfill_owner;
REVOKE CREATE ON SCHEMA titan FROM titan_staging_backfill_owner;

-- The issuer is an independent authenticated *database login*, with no
-- ability to execute the staging backfill. Only a human-reviewed
-- deployment may explicitly grant issuer role membership to that login.
CREATE FUNCTION titan.issue_staging_backfill_approval(
 p_legacy_organisation_id uuid,
 p_company_id uuid,
 p_logto_organisation_id text,
 p_identity_id uuid,
 p_logto_subject text,
 p_membership_role text,
 p_change_ticket text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,titan
SET row_security=on
AS $$
DECLARE
 issued uuid;
BEGIN
 IF current_database() NOT IN
   ('titan_shared_ci','titan_shared_staging','titan_shared_backfill_ci') THEN
   RAISE EXCEPTION 'staging approval issuance prohibited in this database';
 END IF;
 IF p_logto_organisation_id IS NULL OR length(btrim(p_logto_organisation_id))=0
    OR p_logto_subject IS NULL OR length(btrim(p_logto_subject))=0
    OR p_membership_role NOT IN ('owner','admin','manager','member','learner')
    OR p_change_ticket IS NULL OR length(btrim(p_change_ticket))<4
    OR length(p_change_ticket)>128
 THEN RAISE EXCEPTION 'invalid approval request'; END IF;
 -- Only verified, exact company/Logto pairs. Lock prevents concurrent
 -- revocation before the approved row is created.
 PERFORM 1 FROM titan.central_legacy_company_links l
 JOIN titan.companies c ON c.id=l.company_id
 WHERE l.legacy_organisation_id=p_legacy_organisation_id
   AND l.company_id=p_company_id
   AND l.logto_organisation_id=p_logto_organisation_id
   AND l.status='verified' AND l.verified_at IS NOT NULL
   AND c.status='active'
 FOR SHARE OF l,c;
 IF NOT FOUND THEN RAISE EXCEPTION 'company mapping not verified'; END IF;
 -- Uniqueness also enforced by canonical identities on consumption.
 INSERT INTO titan.staging_backfill_approvals(
 legacy_organisation_id,company_id,logto_organisation_id,
 identity_id,logto_subject,identity_status,membership_role,
 approved_by,change_ticket,expires_at)
 VALUES (p_legacy_organisation_id,p_company_id,p_logto_organisation_id,
 p_identity_id,p_logto_subject,'active',p_membership_role,
 session_user,p_change_ticket,transaction_timestamp()+interval '5 minutes')
 RETURNING approval_id INTO issued;
 RETURN issued;
END $$;
REVOKE ALL ON FUNCTION titan.issue_staging_backfill_approval(
 uuid,uuid,text,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.issue_staging_backfill_approval(
 uuid,uuid,text,uuid,text,text,text) TO titan_staging_approval_issuer;
GRANT CREATE ON SCHEMA titan TO titan_staging_approval_owner;
ALTER FUNCTION titan.issue_staging_backfill_approval(
 uuid,uuid,text,uuid,text,text,text) OWNER TO titan_staging_approval_owner;
REVOKE CREATE ON SCHEMA titan FROM titan_staging_approval_owner;

COMMENT ON FUNCTION titan.issue_staging_backfill_approval(
 uuid,uuid,text,uuid,text,text,text) IS
 'Separate authenticated staging issuer; approved_by is actual session_user, not a supplied name. Does not execute data writes.';
COMMENT ON ROLE titan_staging_backfill_owner IS
 'NOLOGIN least-privilege owner of staging backfill function; never grant to browser, production or application login';
COMMENT ON ROLE titan_staging_approval_owner IS
 'NOLOGIN least-privilege owner of staging approval issuance function; separate from backfill owner';
COMMIT;
