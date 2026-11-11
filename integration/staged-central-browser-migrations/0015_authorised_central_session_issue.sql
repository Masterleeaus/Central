-- Prevent a login/revocation race: session creation must lock current
-- membership, identity, organisation and a live entitlement until COMMIT.
-- Access reduction UPDATEs then wait, delete the newly issued session in
-- their trigger and commit; or win first so issuance is rejected.
BEGIN;
CREATE FUNCTION titan.central_issue_browser_session(
  p_digest char(64),p_subject text,p_organisation uuid,p_expires timestamptz
) RETURNS char(64)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
DECLARE
  verified_id uuid;
  entitled_id uuid;
  stored char(64);
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
     OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 256
     OR p_organisation IS NULL OR p_expires IS NULL
     OR p_expires<=now() OR p_expires>now()+interval '8 hours 1 minute' THEN
    RAISE EXCEPTION 'invalid central session issuance request';
  END IF;
  SELECT i.id INTO verified_id
  FROM titan.identities i
  JOIN titan.memberships m ON m.identity_id=i.id
  JOIN titan.organisations o ON o.id=m.organisation_id
  WHERE i.logto_subject=p_subject AND i.state='active'
    AND o.id=p_organisation AND o.state='active'
    AND m.state='active'
    AND (m.expires_at IS NULL OR m.expires_at>now())
  FOR SHARE OF i,m,o;
  IF verified_id IS NULL THEN
    RAISE EXCEPTION 'central session membership not authorised';
  END IF;
  SELECT e.id INTO entitled_id
  FROM titan.entitlements e
  WHERE e.organisation_id=p_organisation
    AND e.state IN ('active','trialing')
    AND (e.expires_at IS NULL OR e.expires_at>now())
  ORDER BY e.id
  LIMIT 1
  FOR SHARE OF e;
  IF entitled_id IS NULL THEN
    RAISE EXCEPTION 'central session has no active entitlement';
  END IF;
  INSERT INTO titan.central_browser_sessions(
    token_digest,logto_subject,organisation_id,expires_at)
  VALUES(p_digest,p_subject,p_organisation,p_expires)
  RETURNING token_digest INTO stored;
  RETURN stored;
END $$;
REVOKE ALL ON FUNCTION titan.central_issue_browser_session(char(64),text,uuid,timestamptz) FROM PUBLIC;
REVOKE INSERT ON titan.central_browser_sessions FROM titan_central_sessions;
GRANT EXECUTE ON FUNCTION titan.central_issue_browser_session(char(64),text,uuid,timestamptz)
 TO titan_central_sessions;
COMMENT ON FUNCTION titan.central_issue_browser_session(char(64),text,uuid,timestamptz) IS
 'Authorise and lock current identity, membership, company and entitlement during Central session insertion, preventing revocation races.';
COMMIT;
