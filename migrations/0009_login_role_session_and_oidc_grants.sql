-- Grants for the service login path: the session-revocation store and the OIDC login-state store
-- in apps/control-api. Applied after 0008; 0001 to 0008 are not edited.
--
-- The login role (titan_central_app) is NOINHERIT and holds no table privileges itself. Every
-- statement in session-revocation-pg.mjs and oidc-state-pg.mjs runs inside a transaction that
-- does SET LOCAL ROLE titan_trusted_reader or SET LOCAL ROLE titan_trusted_writer, so every grant
-- below goes to one of those two roles and nothing goes to the login role.
--
-- Statement inventory and the privilege each one needs:
--   session-revocation-pg.mjs readVersion   SELECT generation FROM titan_session_revocations
--                                           -> titan_trusted_reader SELECT. Already granted by 0007.
--                                              Not granted again here.
--   session-revocation-pg.mjs revokeAll     INSERT ... ON CONFLICT DO UPDATE ... RETURNING generation
--                                           -> titan_trusted_writer INSERT, UPDATE and SELECT.
--                                              Granted by 0007 and 0008. Not granted again here.
--   oidc-state-pg.mjs save                  INSERT INTO titan_oidc_login_states
--                                           -> titan_trusted_writer INSERT. Granted by 0007.
--   oidc-state-pg.mjs consume               DELETE ... WHERE application_id, state_digest, expires_at
--                                           RETURNING nonce, code_verifier, binding_hash, expires_at
--                                           -> titan_trusted_writer DELETE (0007) and SELECT on the
--                                              columns the statement reads. SELECT is missing and is
--                                              granted below.
--   oidc-state-pg.mjs pruneExpired          DELETE ... WHERE (application_id, state_digest) IN
--                                           (SELECT application_id, state_digest ... WHERE expires_at ...)
--                                           -> titan_trusted_writer DELETE (0007) and SELECT on the
--                                              columns the subquery reads. Covered by the grant below.
--
-- Column-level SELECT is used rather than table-level SELECT. created_at is not read by any
-- statement, so it is not granted. Neither role gets UPDATE on the login-state table.
BEGIN;

-- Consume and prune read these columns to match rows and return the sealed values.
-- Without this grant, the writer's DELETE ... RETURNING fails with permission denied.
GRANT SELECT (application_id, state_digest, nonce, code_verifier, binding_hash, expires_at)
  ON titan.titan_oidc_login_states TO titan_trusted_writer;

COMMIT;
