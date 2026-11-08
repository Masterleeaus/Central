-- SELECT FOR SHARE and RLS: a row-locking SELECT observes applicable
-- UPDATE policies. The function owners have UPDATE(status) privilege
-- solely to acquire the row locks; this permits only an active->active
-- or verified->verified status update, never changing company state.
-- They have no column UPDATE rights on IDs or Logto mappings.
BEGIN;
CREATE POLICY staging_lock_company_status ON titan.companies
 FOR UPDATE TO titan_staging_backfill_owner,titan_staging_approval_owner
 USING(status='active') WITH CHECK(status='active');
CREATE POLICY staging_lock_mapping_status ON titan.central_legacy_company_links
 FOR UPDATE TO titan_staging_backfill_owner,titan_staging_approval_owner
 USING(status='verified' AND verified_at IS NOT NULL)
 WITH CHECK(status='verified' AND verified_at IS NOT NULL);
COMMIT;
