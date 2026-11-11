-- Separate per-product database roles: an app must not read, delete or
-- consume another app's pending company selection states.
-- Preserve old role migration history and revoke its privileges forward-only.
BEGIN;
DO $$
DECLARE app text;
BEGIN
 FOREACH app IN ARRAY ARRAY['field','desk','academy'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_product_selection_'||app) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT','titan_product_selection_'||app);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA titan TO %I','titan_product_selection_'||app);
  EXECUTE format('GRANT SELECT,INSERT,DELETE ON titan.product_company_selection_states TO %I','titan_product_selection_'||app);
  EXECUTE format(
   'CREATE POLICY %I ON titan.product_company_selection_states FOR ALL TO %I USING (application_id=%L) WITH CHECK (application_id=%L)',
   'product_selection_'||app,'titan_product_selection_'||app,app,app);
 END LOOP;
END $$;
DROP POLICY product_company_selection_role ON titan.product_company_selection_states;
REVOKE ALL ON titan.product_company_selection_states FROM titan_product_selection;
COMMENT ON TABLE titan.product_company_selection_states IS
 'One-use product choice sealed by app-bound AES-GCM. Each product uses its own NOLOGIN database role and tenant-namespaced RLS policy.';
COMMIT;
