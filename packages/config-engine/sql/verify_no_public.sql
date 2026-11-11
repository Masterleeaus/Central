\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_namespace n,
  LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
  WHERE n.nspname='titan_config' AND a.grantee=0 AND a.privilege_type='USAGE'
 ) THEN RAISE EXCEPTION 'PUBLIC has configuration schema usage'; END IF;
 IF EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
  LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='titan_config' AND c.relname IN ('definitions','audit')
    AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
 ) THEN RAISE EXCEPTION 'PUBLIC has configuration table privileges'; END IF;
END $$;
