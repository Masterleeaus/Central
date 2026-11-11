-- PostgreSQL SELECT ... FOR SHARE requires UPDATE privilege on at least
-- one target column. Grant only UPDATE(status), never table-wide UPDATE.
-- FORCE RLS has NO UPDATE policy for either function owner, so DML UPDATE
-- still affects zero rows; the privilege exists solely for row locking.
BEGIN;
GRANT UPDATE(status) ON titan.companies,titan.central_legacy_company_links
 TO titan_staging_backfill_owner,titan_staging_approval_owner;
-- Fail closed: owners must not have a broad UPDATE policy on either table.
DO $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_policies
  WHERE schemaname='titan'
    AND tablename IN ('companies','central_legacy_company_links')
    AND cmd IN ('UPDATE','ALL')
    AND (
      'titan_staging_backfill_owner'=ANY(roles)
      OR 'titan_staging_approval_owner'=ANY(roles)
      OR 'public'=ANY(roles)
    )
 ) THEN
  RAISE EXCEPTION 'row-lock owner inherited unexpected UPDATE RLS policy';
 END IF;
END $$;
COMMIT;
