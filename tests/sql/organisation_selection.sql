-- Organisation selection store (migration 0016, issue #32) on PostgreSQL 16.
-- Covers the statements run by apps/control-api/src/organisation-selection-pg.mjs, as the service login
-- role titan_central_app, switching to titan_trusted_writer (or titan_trusted_reader) with SET LOCAL ROLE.
--
-- Run as a superuser against a database where migrations 0001-0009 and 0016 are applied (0014 and 0015 are
-- not required by this script):
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/organisation_selection.sql "$DATABASE_URL"
-- The database must hold no rows in titan.titan_oidc_organisation_selections (the script checks this).
--
-- Everything runs in one transaction that ends with ROLLBACK, so the database is left unchanged.
-- Any expected success that fails, or any expected refusal that succeeds, raises an exception and psql exits non-zero.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- helpers
-- A statement that must be refused for lack of privilege (SQLSTATE 42501).
CREATE FUNCTION pg_temp.expect_permission_denied(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok (denied): %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL denied statement succeeded: %', label;
END $$;

-- A statement that must fail with a specific SQLSTATE (for example 23505 unique, 23514 check).
CREATE FUNCTION pg_temp.expect_sqlstate(label text, stmt text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = want THEN
      RAISE NOTICE 'ok (refused %): %', want, label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL % raised SQLSTATE % (wanted %): %', label, SQLSTATE, want, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL refused statement succeeded: %', label;
END $$;

-- Rows visible to the current role must equal expected.
CREATE FUNCTION pg_temp.expect_count(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: % = %', label, n;
END $$;

-- One-use claim, the same statement as consume() in organisation-selection-pg.mjs (now() stands in for the clock).
-- Returns the candidate organisation IDs and the sealed ID token from the row it claimed; no row when refused.
CREATE FUNCTION pg_temp.consume_selection(app text, bind text)
RETURNS TABLE(out_orgs text[], out_sealed text) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT s.application_id, s.binding_hash, s.organisation_ids, s.sealed_id_token
    FROM titan.titan_oidc_organisation_selections AS s
    WHERE s.application_id = app AND s.binding_hash = bind AND s.consumed_at IS NULL AND s.expires_at > now()
    FOR UPDATE
  )
  UPDATE titan.titan_oidc_organisation_selections AS s
  SET consumed_at = now(), sealed_id_token = NULL
  FROM claimed c
  WHERE s.application_id = c.application_id AND s.binding_hash = c.binding_hash
  RETURNING c.organisation_ids, c.sealed_id_token;
END $$;

-- Prunes one bounded batch, the same statement as pruneExpiredSelections() in the module.
CREATE FUNCTION pg_temp.prune_batch(batch integer) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM titan.titan_oidc_organisation_selections
  WHERE (application_id, binding_hash) IN (
    SELECT application_id, binding_hash FROM titan.titan_oidc_organisation_selections
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- setup
-- The table must be empty so the counts below are exact.
DO $$
BEGIN
  IF (SELECT count(*) FROM titan.titan_oidc_organisation_selections) <> 0 THEN
    RAISE EXCEPTION 'titan.titan_oidc_organisation_selections is not empty; run on a freshly migrated database';
  END IF;
END $$;

-- The service login role: NOINHERIT, no table privileges, member of the trusted roles only (as in login_role_path.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'titan_central_app') THEN
    CREATE ROLE titan_central_app NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT titan_trusted_reader, titan_trusted_writer TO titan_central_app;
-- ---------------------------------------------------------------- 1. privilege grants
SELECT pg_temp.expect_count('login role holds no table privilege on selections',
  $q$SELECT 1 WHERE has_table_privilege('titan_central_app','titan.titan_oidc_organisation_selections','SELECT')
     OR has_table_privilege('titan_central_app','titan.titan_oidc_organisation_selections','INSERT')
     OR has_table_privilege('titan_central_app','titan.titan_oidc_organisation_selections','UPDATE')
     OR has_table_privilege('titan_central_app','titan.titan_oidc_organisation_selections','DELETE')$q$, 0);
SELECT pg_temp.expect_count('reader and tenant roles hold no privilege on selections',
  $q$SELECT 1 WHERE has_table_privilege('titan_trusted_reader','titan.titan_oidc_organisation_selections','SELECT')
     OR has_table_privilege('titan_tenant_app','titan.titan_oidc_organisation_selections','SELECT')
     OR has_table_privilege('titan_tenant_app','titan.titan_oidc_organisation_selections','INSERT')
     OR has_table_privilege('titan_tenant_app','titan.titan_oidc_organisation_selections','UPDATE')
     OR has_table_privilege('titan_tenant_app','titan.titan_oidc_organisation_selections','DELETE')$q$, 0);
SELECT pg_temp.expect_count('writer may update only consumed_at and sealed_id_token, and may not update digests',
  $q$SELECT 1 WHERE has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','consumed_at','UPDATE')
     AND has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','sealed_id_token','UPDATE')
     AND NOT has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','state_digest','UPDATE')
     AND NOT has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','binding_hash','UPDATE')
     AND NOT has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','organisation_ids','UPDATE')$q$, 1);
SELECT pg_temp.expect_count('writer may not set created_at on insert',
  $q$SELECT 1 WHERE NOT has_column_privilege('titan_trusted_writer','titan.titan_oidc_organisation_selections','created_at','INSERT')$q$, 1);

-- Checks above run as the superuser: they name each role explicitly and need no schema privilege.
SET SESSION AUTHORIZATION titan_central_app;

-- ---------------------------------------------------------------- 2. tenant and reader paths are refused
SET LOCAL ROLE titan_trusted_reader;
SELECT pg_temp.expect_permission_denied('reader cannot read pending selections',
  'SELECT count(*) FROM titan.titan_oidc_organisation_selections');
RESET ROLE;

-- ---------------------------------------------------------------- 3. the writer path
SET LOCAL ROLE titan_trusted_writer;

-- A valid two-organisation selection for browser A (binding 'A'), state 'S', valid for five minutes.
INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at)
VALUES ('desk', repeat('A',43), repeat('S',43), repeat('H',43), 'https://auth.titan.example', 'sub-A',
        ARRAY['org-a','org-b'], 'sealed.token.a', now() + interval '5 minutes');

-- Usable once: the first claim returns the candidate list and the sealed token, the second finds nothing.
SELECT pg_temp.expect_count('first claim returns the saved candidate list',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('A',43)) AS c(out_orgs, out_sealed) WHERE out_orgs = ARRAY['org-a','org-b'] AND out_sealed = 'sealed.token.a'$q$, 1);
SELECT pg_temp.expect_count('a second claim of the same selection is refused (one use)',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('A',43)) AS c(out_orgs, out_sealed)$q$, 0);
SELECT pg_temp.expect_count('the claimed row keeps its audit marker and loses its sealed token',
  $q$SELECT 1 FROM titan.titan_oidc_organisation_selections WHERE binding_hash = repeat('A',43) AND consumed_at IS NOT NULL AND sealed_id_token IS NULL$q$, 1);

-- Expired refused: a selection whose expiry has passed cannot be claimed.
INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at)
VALUES ('desk', repeat('B',43), repeat('T',43), repeat('I',43), 'https://auth.titan.example', 'sub-A',
        ARRAY['org-a','org-b'], 'sealed.token.b', now() - interval '1 second');
SELECT pg_temp.expect_count('an expired selection is refused',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('B',43)) AS c(out_orgs, out_sealed)$q$, 0);

-- Foreign organisation: the claimed candidate list is exactly the saved list, so org-c was never selectable.
-- The adapter refuses any organisation_id outside that list (oidc-http-adapter.mjs, foreign_organisation).
SELECT pg_temp.expect_count('a foreign organisation is not in the candidate list of the claimed selection',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('A',43)) AS c(out_orgs, out_sealed) WHERE 'org-c' = ANY(out_orgs)$q$, 0);
-- The same selection cannot be claimed under another application, nor by another browser binding.
INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at)
VALUES ('desk', repeat('C',43), repeat('U',43), repeat('J',43), 'https://auth.titan.example', 'sub-C',
        ARRAY['org-c','org-d'], 'sealed.token.c', now() + interval '5 minutes');
SELECT pg_temp.expect_count('another application cannot claim the selection',
  $q$SELECT 1 FROM pg_temp.consume_selection('field', repeat('C',43)) AS c(out_orgs, out_sealed)$q$, 0);
SELECT pg_temp.expect_count('a different browser binding cannot claim the selection',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('Z',43)) AS c(out_orgs, out_sealed)$q$, 0);

-- Constraints: no duplicate binding, no duplicate OIDC state, at least two candidates, no sealed token on a consumed row.
SELECT pg_temp.expect_sqlstate('a duplicate binding is refused (cannot overwrite a pending or spent selection)',
  $q$INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at) VALUES ('desk', repeat('A',43), repeat('V',43), repeat('K',43), 'https://auth.titan.example', 'sub-A', ARRAY['org-a','org-b'], 'x', now() + interval '5 minutes')$q$, '23505');
SELECT pg_temp.expect_sqlstate('a duplicate OIDC state cannot start a second selection',
  $q$INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at) VALUES ('desk', repeat('D',43), repeat('S',43), repeat('L',43), 'https://auth.titan.example', 'sub-A', ARRAY['org-a','org-b'], 'x', now() + interval '5 minutes')$q$, '23505');
SELECT pg_temp.expect_sqlstate('a single-organisation selection is refused',
  $q$INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at) VALUES ('desk', repeat('E',43), repeat('M',43), repeat('N',43), 'https://auth.titan.example', 'sub-A', ARRAY['org-a'], 'x', now() + interval '5 minutes')$q$, '23514');
-- The writer cannot insert a consumed row (no INSERT on consumed_at). The claim path must clear the sealed token in the same UPDATE.
SELECT pg_temp.expect_sqlstate('a claim that leaves a sealed token on a consumed row is refused',
  $q$UPDATE titan.titan_oidc_organisation_selections SET consumed_at = now() WHERE binding_hash = repeat('C',43)$q$, '23514');
SELECT pg_temp.expect_sqlstate('an unknown application is refused',
  $q$INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at) VALUES ('admin', repeat('R',43), repeat('W',43), repeat('X',43), 'https://auth.titan.example', 'sub-A', ARRAY['org-a','org-b'], 'x', now() + interval '5 minutes')$q$, '23514');

-- Pruning: the live selection survives; the expired one and both consumed ones are removed in one batch.
INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at)
VALUES ('desk', repeat('G',43), repeat('Y',43), repeat('O',43), 'https://auth.titan.example', 'sub-G',
        ARRAY['org-a','org-b'], 'sealed.token.g', now() + interval '5 minutes');
-- Rows before prune: A (consumed), B (expired), C (live, never claimed), G (live). Prune removes A and B only.
SELECT pg_temp.expect_count('prune removes the expired and consumed rows only',
  $q$SELECT 1 WHERE pg_temp.prune_batch(100) = 2$q$, 1);
SELECT pg_temp.expect_count('the two live selections remain after pruning',
  $q$SELECT 1 FROM titan.titan_oidc_organisation_selections WHERE expires_at > now() AND consumed_at IS NULL$q$, 2);
SELECT pg_temp.expect_count('a pruned selection cannot be claimed again',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('A',43)) AS c(out_orgs, out_sealed)$q$, 0);
SELECT pg_temp.expect_count('the live selection is still claimable once',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('G',43)) AS c(out_orgs, out_sealed) WHERE out_sealed = 'sealed.token.g'$q$, 1);
SELECT pg_temp.expect_count('and then refused on replay',
  $q$SELECT 1 FROM pg_temp.consume_selection('desk', repeat('G',43)) AS c(out_orgs, out_sealed)$q$, 0);

RESET ROLE;

-- ---------------------------------------------------------------- done
\echo organisation selection SQL checks passed
ROLLBACK;
