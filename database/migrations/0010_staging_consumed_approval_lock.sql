-- One-use approval replay visibility. FOR UPDATE requires UPDATE RLS
-- visibility even when row has already been consumed. The function owner
-- must be able to lock the row *then* explicitly reject consumed_at.
-- It is NOLOGIN and the invoker retains EXECUTE-only privileges.
BEGIN;
DROP POLICY staging_writer_approval_consume ON titan.staging_backfill_approvals;
CREATE POLICY staging_writer_approval_consume
 ON titan.staging_backfill_approvals
 FOR UPDATE TO titan_staging_backfill_owner
 USING(true)
 WITH CHECK(consumed_at IS NOT NULL);
COMMIT;
