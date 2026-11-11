-- Invalidate Central browser sessions in the same transaction as authoritative
-- access reductions. These triggers cover DIRECT SQL changes as well as the
-- audited Central provisioning path. They do not revoke product/Logto cookies.
BEGIN;
CREATE FUNCTION titan.central_revoke_membership_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
BEGIN
  DELETE FROM titan.central_browser_sessions s
   USING titan.identities i
   WHERE i.id=NEW.identity_id
     AND s.logto_subject=i.logto_subject
     AND s.organisation_id=NEW.organisation_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION titan.central_revoke_membership_sessions() FROM PUBLIC;
CREATE TRIGGER central_membership_access_changed
AFTER UPDATE OF state, role, expires_at ON titan.memberships
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.role IS DISTINCT FROM NEW.role
   OR OLD.expires_at IS DISTINCT FROM NEW.expires_at)
EXECUTE FUNCTION titan.central_revoke_membership_sessions();

CREATE FUNCTION titan.central_revoke_organisation_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
BEGIN
  DELETE FROM titan.central_browser_sessions WHERE organisation_id=NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION titan.central_revoke_organisation_sessions() FROM PUBLIC;
CREATE TRIGGER central_organisation_state_changed
AFTER UPDATE OF state ON titan.organisations
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION titan.central_revoke_organisation_sessions();

CREATE FUNCTION titan.central_revoke_identity_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
BEGIN
  DELETE FROM titan.central_browser_sessions WHERE logto_subject=NEW.logto_subject;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION titan.central_revoke_identity_sessions() FROM PUBLIC;
CREATE TRIGGER central_identity_state_changed
AFTER UPDATE OF state ON titan.identities
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION titan.central_revoke_identity_sessions();

CREATE FUNCTION titan.central_revoke_entitlement_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
BEGIN
  DELETE FROM titan.central_browser_sessions WHERE organisation_id=NEW.organisation_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION titan.central_revoke_entitlement_sessions() FROM PUBLIC;
CREATE TRIGGER central_entitlement_changed
AFTER UPDATE OF state, expires_at ON titan.entitlements
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.expires_at IS DISTINCT FROM NEW.expires_at)
EXECUTE FUNCTION titan.central_revoke_entitlement_sessions();

CREATE FUNCTION titan.central_revoke_link_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, titan
AS $$
BEGIN
  DELETE FROM titan.central_browser_sessions s
    USING titan.identities i
    WHERE i.id=NEW.identity_id AND s.logto_subject=i.logto_subject
      AND s.organisation_id=NEW.organisation_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION titan.central_revoke_link_sessions() FROM PUBLIC;
CREATE TRIGGER central_account_link_changed
AFTER UPDATE OF state ON titan.local_account_links
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION titan.central_revoke_link_sessions();

COMMENT ON FUNCTION titan.central_revoke_membership_sessions() IS
 'Atomically deletes Central browser sessions after a membership access change; not a product or Logto logout.';
COMMIT;
