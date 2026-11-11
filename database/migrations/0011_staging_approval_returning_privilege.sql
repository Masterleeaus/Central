-- Approval issuing function INSERT ... RETURNING approval_id needs SELECT on
-- that one column and a matching RLS SELECT policy. Neither the issuer
-- login nor the staging executor receives this privilege.
BEGIN;
GRANT SELECT(approval_id) ON titan.staging_backfill_approvals
 TO titan_staging_approval_owner;
CREATE POLICY staging_issuer_returning_approval_id
 ON titan.staging_backfill_approvals FOR SELECT
 TO titan_staging_approval_owner
 USING(approved_by=session_user AND consumed_at IS NULL);
COMMIT;
