-- Disposable CI only, separate authenticated issuer and executor.
\set ON_ERROR_STOP on
CREATE ROLE titan_approver_ci_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
 PASSWORD 'ci-only-throwaway';
GRANT titan_staging_approval_issuer TO titan_approver_ci_login;
DO $$
BEGIN
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc
 WHERE oid='titan.execute_staging_backfill_approval(uuid)'::regprocedure)
   <> 'titan_staging_backfill_owner'
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc
 WHERE oid='titan.issue_staging_backfill_approval(uuid,uuid,text,uuid,text,text,text)'::regprocedure)
   <> 'titan_staging_approval_owner'
 THEN RAISE EXCEPTION 'SECURITY DEFINER functions still owned by privileged migrator'; END IF;
 IF (SELECT rolbypassrls FROM pg_roles WHERE rolname='titan_staging_backfill_owner')
 OR (SELECT rolbypassrls FROM pg_roles WHERE rolname='titan_staging_approval_owner')
 THEN RAISE EXCEPTION 'function owner bypasses RLS'; END IF;
 IF has_table_privilege('titan_staging_approval_issuer','titan.staging_backfill_approvals','INSERT')
 OR has_table_privilege('titan_staging_approval_issuer','titan.identities','INSERT')
 OR has_table_privilege('titan_staging_backfill_executor','titan.staging_backfill_approvals','INSERT')
 OR has_function_privilege('titan_staging_approval_issuer',
   'titan.execute_staging_backfill_approval(uuid)','EXECUTE')
 OR has_function_privilege('titan_staging_backfill_executor',
   'titan.issue_staging_backfill_approval(uuid,uuid,text,uuid,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'issuer/executor duties are not separated'; END IF;
 IF has_schema_privilege('titan_staging_approval_owner','titan','CREATE')
 OR has_schema_privilege('titan_staging_backfill_owner','titan','CREATE')
 THEN RAISE EXCEPTION 'staging function owner retains schema CREATE'; END IF;
END $$;
