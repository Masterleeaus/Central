-- Internal, read-only bridge lookup for the staged Central launcher migration.
-- The caller must supply BOTH the verified legacy Central organisation UUID and
-- authoritative Logto organisation ID. Unapproved links return no result.
BEGIN;
CREATE FUNCTION titan.resolve_verified_central_company(
  p_legacy_organisation_id uuid,p_logto_organisation_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,titan
AS $$
 SELECT l.company_id
 FROM titan.central_legacy_company_links AS l
 JOIN titan.companies AS c ON c.id=l.company_id
 WHERE l.legacy_organisation_id=p_legacy_organisation_id
   AND l.logto_organisation_id=p_logto_organisation_id
   AND l.status='verified' AND l.verified_at IS NOT NULL
   AND c.status='active'
 LIMIT 1
$$;
REVOKE ALL ON FUNCTION titan.resolve_verified_central_company(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.resolve_verified_central_company(uuid,text)
 TO titan_shared_company_reader;
COMMENT ON FUNCTION titan.resolve_verified_central_company(uuid,text) IS
 'Restricted server-only bridge resolving approved legacy ID plus exact Logto organisation ID to canonical company UUID.';
COMMIT;
