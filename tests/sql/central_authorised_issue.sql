-- Real PostgreSQL regression test of locked, least-privilege session
-- issuance. Fixtures are rolled back. Requires migrations through 0014.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.identities(id,logto_subject,state) VALUES
('00000000-0000-4000-8000-0000000000f1','issue-subject','active');
INSERT INTO titan.organisations(id,logto_organisation_id,state) VALUES
('00000000-0000-4000-8000-0000000000f2','issue-org','active');
INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES
('00000000-0000-4000-8000-0000000000f3','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f2','owner','active');
INSERT INTO titan.entitlements(id,organisation_id,application_id,state) VALUES
('00000000-0000-4000-8000-0000000000f4','00000000-0000-4000-8000-0000000000f2','field','active');
SET LOCAL ROLE titan_central_sessions;
DO $$
DECLARE n integer;
BEGIN
 BEGIN
  INSERT INTO titan.central_browser_sessions(token_digest,logto_subject,organisation_id,expires_at)
   VALUES(repeat('c',64),'issue-subject','00000000-0000-4000-8000-0000000000f2',now()+interval '5 minutes');
  RAISE EXCEPTION 'raw session insert improperly permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM titan.central_issue_browser_session(repeat('a',64)::char(64),
   'issue-subject','00000000-0000-4000-8000-0000000000f2',now()+interval '5 minutes');
 SELECT count(*) INTO n FROM titan.central_browser_sessions;
 IF n<>1 THEN RAISE EXCEPTION 'approved session creation failed'; END IF;
 BEGIN
  PERFORM titan.central_issue_browser_session(repeat('b',64)::char(64),
   'foreign-subject','00000000-0000-4000-8000-0000000000f2',now()+interval '5 minutes');
  RAISE EXCEPTION 'foreign subject granted session';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='foreign subject granted session' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
-- Membership revocation deletes session and prevents new insertion.
UPDATE titan.memberships SET state='revoked' WHERE id='00000000-0000-4000-8000-0000000000f3';
SET LOCAL ROLE titan_central_sessions;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM titan.central_browser_sessions;
 IF n<>0 THEN RAISE EXCEPTION 'membership revocation did not remove existing session'; END IF;
 BEGIN
  PERFORM titan.central_issue_browser_session(repeat('d',64)::char(64),
   'issue-subject','00000000-0000-4000-8000-0000000000f2',now()+interval '5 minutes');
  RAISE EXCEPTION 'revoked membership granted session';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='revoked membership granted session' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
UPDATE titan.memberships SET state='active' WHERE id='00000000-0000-4000-8000-0000000000f3';
UPDATE titan.entitlements SET state='paused' WHERE id='00000000-0000-4000-8000-0000000000f4';
SET LOCAL ROLE titan_central_sessions;
DO $$
BEGIN
 BEGIN
  PERFORM titan.central_issue_browser_session(repeat('e',64)::char(64),
   'issue-subject','00000000-0000-4000-8000-0000000000f2',now()+interval '5 minutes');
  RAISE EXCEPTION 'paused product entitlement granted session';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='paused product entitlement granted session' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
ROLLBACK;
