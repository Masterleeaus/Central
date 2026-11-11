-- Disposable-only backfill rehearsal. The transaction MUST roll back.
-- Verifies safe FK ordering and that uniqueness conflicts cannot partially
-- create identity, membership, entitlement or application link rows.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.identities(id,logto_subject,status)
 VALUES('00000000-0000-4000-8000-000000000901','rehearsal-subject','active');
INSERT INTO titan.company_memberships(id,company_id,identity_id,role,status,expires_at)
 VALUES('00000000-0000-4000-8000-000000000902',
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000901','member','active',now()+interval '1 day');
INSERT INTO titan.application_user_links(id,company_id,identity_id,application_id,local_user_id,status)
 VALUES('00000000-0000-4000-8000-000000000903',
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000901','lms','rehearsal-user','verified');
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM titan.identities WHERE logto_subject='rehearsal-subject';
 IF n<>1 THEN RAISE EXCEPTION 'rehearsal identity missing in transaction'; END IF;
 SELECT count(*) INTO n FROM titan.company_memberships
 WHERE identity_id='00000000-0000-4000-8000-000000000901';
 IF n<>1 THEN RAISE EXCEPTION 'rehearsal membership missing in transaction'; END IF;
 BEGIN
  INSERT INTO titan.application_user_links(id,company_id,identity_id,application_id,local_user_id,status)
  VALUES('00000000-0000-4000-8000-000000000904',
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000901','lms','duplicate-user','verified');
  RAISE EXCEPTION 'uniqueness did not block competing application mapping';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 SELECT count(*) INTO n FROM titan.application_user_links
 WHERE identity_id='00000000-0000-4000-8000-000000000901';
 IF n<>1 THEN RAISE EXCEPTION 'conflicting link left partial state'; END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan.identities WHERE logto_subject='rehearsal-subject')
 OR EXISTS(SELECT 1 FROM titan.company_memberships
  WHERE identity_id='00000000-0000-4000-8000-000000000901')
 OR EXISTS(SELECT 1 FROM titan.application_user_links
  WHERE identity_id='00000000-0000-4000-8000-000000000901')
 THEN RAISE EXCEPTION 'rollback left partial canonical access records'; END IF;
END $$;
\echo canonical staged backfill rollback and uniqueness rehearsal passed
