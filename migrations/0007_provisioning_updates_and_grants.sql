-- Extends provisioning audit to the update and revoke commands added in provisioning.ts.
-- Without this, audit inserts for membership_update, entitlement_update and link_revoke fail.
BEGIN;
ALTER TABLE titan.provisioning_audit DROP CONSTRAINT IF EXISTS provisioning_audit_command_kind_check;
ALTER TABLE titan.provisioning_audit ADD CONSTRAINT provisioning_audit_command_kind_check
  CHECK (command_kind IN ('identity','organisation','membership','entitlement','link','membership_update','entitlement_update','link_revoke'));

-- Session revocation generations: the guard reads them, provisioning bumps them in the same transaction.
GRANT SELECT ON titan.titan_session_revocations TO titan_trusted_reader;
GRANT INSERT, UPDATE ON titan.titan_session_revocations TO titan_trusted_writer;

-- Login state: the app inserts and consumes rows; pruning deletes expired rows. Both use the writer role.
GRANT INSERT, DELETE ON titan.titan_oidc_login_states TO titan_trusted_writer;
COMMIT;
