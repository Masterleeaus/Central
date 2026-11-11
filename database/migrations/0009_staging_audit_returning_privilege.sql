-- The existing staging function INSERT ... RETURNING event_id requires
-- SELECT privilege on event_id and an applicable SELECT RLS policy.
-- Grant only this one column to the non-login function owner. The
-- separately authenticated executor never receives audit SELECT.
BEGIN;
GRANT SELECT(event_id) ON titan.staging_backfill_audit
 TO titan_staging_backfill_owner;
CREATE POLICY staging_audit_returning_event_id
 ON titan.staging_backfill_audit FOR SELECT
 TO titan_staging_backfill_owner USING(result='staging_committed');
COMMIT;
