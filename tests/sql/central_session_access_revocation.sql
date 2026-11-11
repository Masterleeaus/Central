-- Disposable database-only verification of transactionally triggered
-- Central browser revocation. Roll back every fixture at end.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.identities(id,logto_subject,state) VALUES
 ('00000000-0000-4000-8000-0000000000a1','revocation-alice','active'),
 ('00000000-0000-4000-8000-0000000000b1','revocation-bob','active');
INSERT INTO titan.organisations(id,logto_organisation_id,state) VALUES
 ('00000000-0000-4000-8000-000000000001','revocation-org-1','active'),
 ('00000000-0000-4000-8000-000000000002','revocation-org-2','active');
INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES
 ('00000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','owner','active'),
 ('00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-000000000002','member','active');
INSERT INTO titan.entitlements(id,organisation_id,application_id,state) VALUES
 ('00000000-0000-4000-8000-000000000e01','00000000-0000-4000-8000-000000000001','field','active'),
 ('00000000-0000-4000-8000-000000000e02','00000000-0000-4000-8000-000000000002','field','active');
INSERT INTO titan.local_account_links(id,identity_id,organisation_id,application_id,local_user_id,local_account_id,state,verified_at) VALUES
 ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','field','u-a','acct-a','verified',now());
INSERT INTO titan.central_browser_sessions(token_digest,logto_subject,organisation_id,expires_at) VALUES
 (repeat('a',64),'revocation-alice','00000000-0000-4000-8000-000000000001',now()+interval '5 minutes'),
 (repeat('b',64),'revocation-bob','00000000-0000-4000-8000-000000000002',now()+interval '5 minutes');
CREATE FUNCTION pg_temp.expect_sessions(expected integer, reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed integer;
BEGIN
 SELECT count(*) INTO observed FROM titan.central_browser_sessions;
 IF observed<>expected THEN RAISE EXCEPTION 'FAIL %: expected %, saw %',reason,expected,observed; END IF;
END $$;
SELECT pg_temp.expect_sessions(2,'fixtures');
-- A failed provisioning transaction must restore the session row and membership.
SAVEPOINT rollback_revocation;
UPDATE titan.memberships SET state='suspended' WHERE id='00000000-0000-4000-8000-000000000c01';
SELECT pg_temp.expect_sessions(1,'session removed within update transaction');
ROLLBACK TO SAVEPOINT rollback_revocation;
SELECT pg_temp.expect_sessions(2,'rolled-back update restores session');
-- Restricted tenant update also triggers authoritative session invalidation.
SET LOCAL ROLE titan_tenant_app;
SELECT set_config('titan.organisation_id','00000000-0000-4000-8000-000000000001',true);
UPDATE titan.memberships SET state='revoked' WHERE id='00000000-0000-4000-8000-000000000c01';
RESET ROLE;
SELECT pg_temp.expect_sessions(1,'membership revocation');
DO $$
BEGIN
 IF (SELECT count(*) FROM titan.central_browser_sessions WHERE logto_subject='revocation-bob')<>1
 THEN RAISE EXCEPTION 'unrelated tenant session was lost'; END IF;
END $$;
-- Recreate session to verify entitlement-triggered invalidation.
INSERT INTO titan.central_browser_sessions(token_digest,logto_subject,organisation_id,expires_at)
 VALUES(repeat('c',64),'revocation-alice','00000000-0000-4000-8000-000000000001',now()+interval '5 minutes');
UPDATE titan.entitlements SET state='paused' WHERE id='00000000-0000-4000-8000-000000000e01';
SELECT pg_temp.expect_sessions(1,'entitlement reduction');
INSERT INTO titan.central_browser_sessions(token_digest,logto_subject,organisation_id,expires_at)
 VALUES(repeat('d',64),'revocation-alice','00000000-0000-4000-8000-000000000001',now()+interval '5 minutes');
UPDATE titan.local_account_links SET state='revoked' WHERE id='00000000-0000-4000-8000-000000000d01';
SELECT pg_temp.expect_sessions(1,'link revocation');
INSERT INTO titan.central_browser_sessions(token_digest,logto_subject,organisation_id,expires_at)
 VALUES(repeat('e',64),'revocation-alice','00000000-0000-4000-8000-000000000001',now()+interval '5 minutes');
UPDATE titan.identities SET state='blocked' WHERE id='00000000-0000-4000-8000-0000000000a1';
SELECT pg_temp.expect_sessions(1,'identity blocked');
UPDATE titan.organisations SET state='suspended' WHERE id='00000000-0000-4000-8000-000000000002';
SELECT pg_temp.expect_sessions(0,'company suspended');
ROLLBACK;
