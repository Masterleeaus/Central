\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='titan_config' AND c.relname IN ('scopes','revisions','audit')
  AND c.relrowsecurity AND c.relforcerowsecurity) <> 3
 THEN RAISE EXCEPTION 'missing enforced RLS'; END IF;
END $$;
