-- Issue #44: read-only, narrowly exposed company discovery for a verified
-- Logto subject. Product/tenant RLS is not weakened to list memberships.
-- The app role can EXECUTE only this vetted function, never read global rows.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_central_discovery') THEN
   CREATE ROLE titan_central_discovery NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION titan.central_eligible_companies(p_logto_subject text)
RETURNS TABLE (organisation_id uuid, logto_organisation_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
 SELECT DISTINCT o.id, o.logto_organisation_id
 FROM titan.identities AS i
 JOIN titan.memberships AS m ON m.identity_id = i.id
 JOIN titan.organisations AS o ON o.id = m.organisation_id
 WHERE i.logto_subject = p_logto_subject
   AND i.state = 'active'
   AND o.state = 'active'
   AND m.state = 'active'
   AND (m.expires_at IS NULL OR m.expires_at > now())
   AND EXISTS (
     SELECT 1 FROM titan.entitlements AS e
     WHERE e.organisation_id = o.id
       AND e.state IN ('active','trialing')
       AND (e.expires_at IS NULL OR e.expires_at > now())
   )
 ORDER BY o.id
 LIMIT 129;
$$;
-- Restrict the security-definer function: PUBLIC has EXECUTE by default.
REVOKE ALL ON FUNCTION titan.central_eligible_companies(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA titan TO titan_central_discovery;
GRANT titan_central_discovery TO titan_central_app;
GRANT EXECUTE ON FUNCTION titan.central_eligible_companies(text) TO titan_central_discovery;
COMMENT ON FUNCTION titan.central_eligible_companies(text) IS
 'Internal trusted OIDC membership discovery. Returns only active companies with a current product entitlement; restricted execution role.';
COMMIT;
