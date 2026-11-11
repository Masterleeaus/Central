-- Dedicated Central login-state namespace and permission boundary.
-- Keep prior migrations immutable. The Central OIDC flow must not share an
-- application_id namespace with any connected product.
BEGIN;
ALTER TABLE titan.titan_oidc_login_states
 DROP CONSTRAINT IF EXISTS titan_oidc_login_states_application_id_check;
ALTER TABLE titan.titan_oidc_login_states
 ADD CONSTRAINT titan_oidc_login_states_application_id_check
 CHECK (application_id IN ('desk','field','academy','central'));
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_central_oidc') THEN
   CREATE ROLE titan_central_oidc NOLOGIN NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA titan TO titan_central_oidc;
GRANT titan_central_oidc TO titan_central_app;
-- DELETE RETURNING requires SELECT on returned fields.
GRANT SELECT, INSERT, DELETE ON titan.titan_oidc_login_states TO titan_central_oidc;
GRANT SELECT ON titan.titan_oidc_login_states TO titan_trusted_writer;
ALTER TABLE titan.titan_oidc_login_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.titan_oidc_login_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_oidc_namespace ON titan.titan_oidc_login_states;
CREATE POLICY central_oidc_namespace ON titan.titan_oidc_login_states
 FOR ALL TO titan_central_oidc
 USING (application_id='central') WITH CHECK (application_id='central');
DROP POLICY IF EXISTS product_oidc_namespace ON titan.titan_oidc_login_states;
CREATE POLICY product_oidc_namespace ON titan.titan_oidc_login_states
 FOR ALL TO titan_trusted_writer
 USING (application_id IN ('desk','field','academy'))
 WITH CHECK (application_id IN ('desk','field','academy'));
COMMENT ON TABLE titan.titan_oidc_login_states IS
 'Short-lived one-use login state sealed at rest; central and product namespaces are isolated by RLS.';
COMMIT;
