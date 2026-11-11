-- Disposable PostgreSQL regression check. Must run after migration 0009.
-- All fixtures are rolled back; do not run against production.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan.organisations (id,logto_organisation_id,state)
 VALUES ('00000000-0000-4000-8000-0000000000f1','browser-session-fixture','active');
INSERT INTO titan.central_browser_sessions
 (token_digest,logto_subject,organisation_id,expires_at)
 VALUES (repeat('a',64),'verified-subject','00000000-0000-4000-8000-0000000000f1',now()+interval '15 minutes');

-- Only the dedicated role may inspect and mutate session records.
SET LOCAL ROLE titan_trusted_reader;
DO $$
BEGIN
  BEGIN
    PERFORM token_digest FROM titan.central_browser_sessions;
    RAISE EXCEPTION 'trusted reader unexpectedly accessed browser sessions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE titan_tenant_app;
DO $$
BEGIN
  BEGIN
    PERFORM token_digest FROM titan.central_browser_sessions;
    RAISE EXCEPTION 'tenant role unexpectedly accessed browser sessions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE titan_central_sessions;
DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM titan.central_browser_sessions WHERE token_digest=repeat('a',64);
  IF c <> 1 THEN RAISE EXCEPTION 'session role could not read its session'; END IF;
  DELETE FROM titan.central_browser_sessions WHERE token_digest=repeat('a',64);
  GET DIAGNOSTICS c=ROW_COUNT;
  IF c <> 1 THEN RAISE EXCEPTION 'session deletion not atomic'; END IF;
  DELETE FROM titan.central_browser_sessions WHERE token_digest=repeat('a',64);
  GET DIAGNOSTICS c=ROW_COUNT;
  IF c <> 0 THEN RAISE EXCEPTION 'duplicate deletion unexpectedly succeeded'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
