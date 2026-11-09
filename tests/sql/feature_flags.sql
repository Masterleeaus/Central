-- Feature-flag test for migration 0013 (titan.feature_flags, titan.feature_flag_history).
-- Run as a superuser against a database where migrations 0001-0009 and 0013 are applied:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/feature_flags.sql "$DATABASE_URL"
-- Everything runs inside one transaction that is rolled back at the end, so the database is left
-- unchanged. Any unexpected acceptance or rejection (wrong SQLSTATE) raises and psql exits non-zero.
\set ON_ERROR_STOP on
BEGIN;

-- expect_fail: the statement must raise exactly this SQLSTATE; success is a failure.
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text, want text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text := NULL;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
  END;
  IF got IS NULL THEN
    RAISE EXCEPTION 'FAIL %: statement succeeded but was expected to raise SQLSTATE %', label, want;
  END IF;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got %', label, want, got;
  END IF;
  RAISE NOTICE 'ok (rejected SQLSTATE %): %', got, label;
END $$;

-- expect_affected: a statement must succeed and affect exactly expected rows.
CREATE FUNCTION pg_temp.expect_affected(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- expect_count: a query must return exactly expected rows of a count.
CREATE FUNCTION pg_temp.expect_count(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || query || ') AS visible' INTO n;
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, saw %', label, expected, n;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- ---------------------------------------------------------------- seed (superuser)
INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'ff-test-org-a', 'active'),
  ('00000000-0000-4000-8000-0000000000b2', 'ff-test-org-b', 'active');
SELECT pg_catalog.set_config('titan.change_actor', 'ops-test', true), pg_catalog.set_config('titan.change_reason', 'feature-flag test seed', true);

-- ---------------------------------------------------------------- accepted declarations and values
SELECT pg_temp.expect_affected('boolean flag, global, default false', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'production', 'bulk_export', NULL, 'boolean', '[true, false]', 'false', 'sorted-team', 'false')$s$, 1);
SELECT pg_temp.expect_affected('enum flag, staging, default classic', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value) VALUES ('supercharged', 'staging', 'ui_theme', NULL, 'enum', '["classic", "compact"]', '"classic"', 'desk-team', '"classic"')$s$, 1);
SELECT pg_temp.expect_affected('integer flag, bounded 1..500, default 50', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'production', 'max_rows', NULL, 'integer', '{"min": 1, "max": 500}', '50', 'lms-team', '50')$s$, 1);
SELECT pg_temp.expect_affected('central-scoped boolean flag in development', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value) VALUES ('central', 'development', 'bulk_export', NULL, 'boolean', '[true, false]', 'true', 'platform-team', 'true')$s$, 1);
SELECT pg_temp.expect_affected('temporary override for org a (sorted, production, bulk_export) with expiry',$s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value, expires_at) VALUES ('sorted', 'production', 'bulk_export', '00000000-0000-4000-8000-0000000000a1', 'boolean', '[true, false]', 'false', 'sorted-team', 'true', now() + interval '1 day')$s$, 1);
SELECT pg_temp.expect_affected('cohort rule on a global row, no rollout', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value, cohort) VALUES ('sorted', 'staging', 'bulk_export', NULL, 'boolean', '[true, false]', 'false', 'sorted-team', 'true', 'pilot-a')$s$, 1);
SELECT pg_temp.expect_affected('percentage rollout on a global row', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value, rollout_percent) VALUES ('lms', 'staging', 'max_rows', NULL, 'integer', '{"min": 1, "max": 500}', '50', 'lms-team', '100', 10)$s$, 1);

-- ---------------------------------------------------------------- CHECK constraints reject wrong types and values
SELECT pg_temp.expect_fail('boolean flag rejects a string value', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'wrong_bool', 'boolean', '[true, false]', 'false', 'o', '"yes"')$s$, '23514');
SELECT pg_temp.expect_fail('boolean flag rejects a number value', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'wrong_bool2', 'boolean', '[true, false]', 'false', 'o', '1')$s$, '23514');
SELECT pg_temp.expect_fail('enum flag rejects a value outside allowed values', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('supercharged', 'development', 'wrong_enum', 'enum', '["classic", "compact"]', '"classic"', 'o', '"dark"')$s$, '23514');
SELECT pg_temp.expect_fail('enum flag rejects a non-string value', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('supercharged', 'development', 'wrong_enum2', 'enum', '["classic", "compact"]', '"classic"', 'o', '3')$s$, '23514');
SELECT pg_temp.expect_fail('integer flag rejects a value above max', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'wrong_int', 'integer', '{"min": 1, "max": 500}', '50', 'o', '501')$s$, '23514');
SELECT pg_temp.expect_fail('integer flag rejects a fractional value', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'wrong_int2', 'integer', '{"min": 1, "max": 500}', '50', 'o', '1.5')$s$, '23514');
SELECT pg_temp.expect_fail('integer flag rejects a numeric string', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'wrong_int3', 'integer', '{"min": 1, "max": 500}', '50', 'o', '"10"')$s$, '23514');
SELECT pg_temp.expect_fail('default must match the declared type', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'bad_default', 'boolean', '[true, false]', '1', 'o', 'false')$s$, '23514');
SELECT pg_temp.expect_fail('enum allowed values must be distinct', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('supercharged', 'development', 'dup_enum', 'enum', '["a", "a"]', '"a"', 'o', '"a"')$s$, '23514');
SELECT pg_temp.expect_fail('integer bounds must have min <= max', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'inv_int', 'integer', '{"min": 9, "max": 1}', '5', 'o', '5')$s$, '23514');
SELECT pg_temp.expect_fail('boolean allowed values must be exactly [true, false]', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'bad_bool_allowed', 'boolean', '[true]', 'true', 'o', 'true')$s$, '23514');
SELECT pg_temp.expect_fail('unknown flag type is rejected', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'bad_type', 'string', '["x"]', '"x"', 'o', '"x"')$s$, '23514');
SELECT pg_temp.expect_fail('legacy product id is rejected', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('desk', 'development', 'legacy_product', 'boolean', '[true, false]', 'false', 'o', 'false')$s$, '23514');
SELECT pg_temp.expect_fail('unknown environment is rejected', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'dev', 'bad_env', 'boolean', '[true, false]', 'false', 'o', 'false')$s$, '23514');
SELECT pg_temp.expect_fail('flag key must be lower snake case', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'BadKey', 'boolean', '[true, false]', 'false', 'o', 'false')$s$, '23514');
SELECT pg_temp.expect_fail('owner is required', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'no_owner', 'boolean', '[true, false]', 'false', '  ', 'false')$s$, '23514');
SELECT pg_temp.expect_fail('rollout percentage above 100 is rejected', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value, rollout_percent) VALUES ('lms', 'development', 'big_rollout', 'integer', '{"min": 1, "max": 500}', '50', 'o', '60', 101)$s$, '23514');
SELECT pg_temp.expect_fail('override requires expires_at', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'development', 'no_expiry', '00000000-0000-4000-8000-0000000000a1', 'boolean', '[true, false]', 'false', 'o', 'true')$s$, '23514');
SELECT pg_temp.expect_fail('override cannot also carry a rollout', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value, owner, value, expires_at, rollout_percent) VALUES ('sorted', 'development', 'override_rollout', '00000000-0000-4000-8000-0000000000a1', 'boolean', '[true, false]', 'false', 'o', 'true', now() + interval '1 day', 10)$s$, '23514');
SELECT pg_temp.expect_fail('cohort and rollout cannot both be set', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value, rollout_percent, cohort) VALUES ('sorted', 'development', 'two_rules', 'boolean', '[true, false]', 'false', 'o', 'true', 10, 'pilot-a')$s$, '23514');
SELECT pg_temp.expect_fail('a scope cannot be created twice', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('sorted', 'production', 'bulk_export', 'boolean', '[true, false]', 'false', 'sorted-team', 'true')$s$, '23505');
SELECT pg_temp.expect_fail('a new scope must start at revision 1', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value, revision) VALUES ('lms', 'development', 'rev_start', 'boolean', '[true, false]', 'false', 'o', 'false', 4)$s$, '23514');

-- ---------------------------------------------------------------- audit: actor and reason are required
SELECT pg_catalog.set_config('titan.change_actor', '', true);
SELECT pg_temp.expect_fail('a change without an actor is refused', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'no_actor', 'boolean', '[true, false]', 'false', 'o', 'false')$s$, '23514');
SELECT pg_catalog.set_config('titan.change_actor', 'ops-test', true);
SELECT pg_catalog.set_config('titan.change_reason', '   ', true);
SELECT pg_temp.expect_fail('a change with a blank reason is refused', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('lms', 'development', 'no_reason', 'boolean', '[true, false]', 'false', 'o', 'false')$s$, '23514');
SELECT pg_catalog.set_config('titan.change_reason', 'feature-flag test seed', true);

SELECT pg_temp.expect_count('each created scope has one create history row at revision 1',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'ui_theme' AND action = 'create' AND revision = 1$s$, 1);
SELECT pg_temp.expect_count('history snapshot holds the value and declared type',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'max_rows' AND snapshot->>'flag_type' = 'integer' AND snapshot->>'value' = '50' AND actor = 'ops-test'$s$, 1);

-- ---------------------------------------------------------------- staged change, revision discipline
SELECT pg_temp.expect_affected('set ui_theme to compact at expected revision 1',
  $s$UPDATE titan.feature_flags SET value = '"compact"', revision = revision + 1 WHERE flag_key = 'ui_theme' AND revision = 1$s$, 1);
SELECT pg_temp.expect_affected('stale expected revision matches nothing',
  $s$UPDATE titan.feature_flags SET value = '"classic"', revision = revision + 1 WHERE flag_key = 'ui_theme' AND revision = 1$s$, 0);
SELECT pg_temp.expect_fail('revision cannot skip ahead', $s$UPDATE titan.feature_flags SET value = '"classic"', revision = 7 WHERE flag_key = 'ui_theme' AND revision = 2$s$, '23514');
SELECT pg_temp.expect_fail('scope identity is immutable', $s$UPDATE titan.feature_flags SET flag_key = 'ui_theme_moved' WHERE flag_key = 'ui_theme' AND revision = 2$s$, '23514');
SELECT pg_temp.expect_fail('an update that breaks the type is refused', $s$UPDATE titan.feature_flags SET value = '"dark"', revision = revision + 1 WHERE flag_key = 'ui_theme' AND revision = 2$s$, '23514');
SELECT pg_temp.expect_count('ui_theme is at revision 2 with the compact value',
  $s$SELECT 1 FROM titan.feature_flags WHERE flag_key = 'ui_theme' AND revision = 2 AND value = '"compact"'$s$, 1);
SELECT pg_temp.expect_count('a set is recorded as action set',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'ui_theme' AND action = 'set' AND revision = 2 AND snapshot->>'value' = 'compact'$s$, 1);

-- Org a override (sorted/production/bulk_export, revision 1, expires tomorrow) moves to revision 2 with
-- an expiry that has already passed. Revision 2 is then a snapshot that must not be restored.
SELECT pg_temp.expect_affected('move org a override to an already-expired expiry (revision 2)',
  $s$UPDATE titan.feature_flags SET value = 'false', expires_at = now() - interval '1 minute', revision = revision + 1 WHERE flag_key = 'bulk_export' AND product = 'sorted' AND environment = 'production' AND organisation_id = '00000000-0000-4000-8000-0000000000a1' AND revision = 1$s$, 1);

-- ---------------------------------------------------------------- history is append-only
SELECT pg_temp.expect_fail('history UPDATE is refused by trigger', $s$UPDATE titan.feature_flag_history SET reason = 'edited'$s$, '42501');
SELECT pg_temp.expect_fail('history DELETE is refused by trigger', $s$DELETE FROM titan.feature_flag_history$s$, '42501');
SELECT pg_temp.expect_fail('history TRUNCATE is refused by trigger', $s$TRUNCATE titan.feature_flag_history$s$, '42501');
SET ROLE titan_trusted_writer;
SELECT pg_temp.expect_fail('trusted writer cannot UPDATE history (no grant)', $s$UPDATE titan.feature_flag_history SET reason = 'edited'$s$, '42501');
SELECT pg_temp.expect_fail('trusted writer cannot DELETE history (no grant)', $s$DELETE FROM titan.feature_flag_history$s$, '42501');
SELECT pg_temp.expect_fail('trusted writer cannot DELETE a flag scope (no grant)', $s$DELETE FROM titan.feature_flags WHERE flag_key = 'ui_theme'$s$, '42501');
RESET ROLE;
SELECT pg_temp.expect_count('history is unchanged after refused edits',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'ui_theme'$s$, 2);

-- ---------------------------------------------------------------- rollback
SELECT pg_temp.expect_fail('rollback to a revision that does not exist', $s$SELECT titan.feature_flag_rollback('sorted', 'production', 'bulk_export', NULL, 1, 99, 'ops-test', 'rollback test')$s$, 'P0002');
SELECT pg_temp.expect_fail('rollback to an expired override is refused', $s$SELECT titan.feature_flag_rollback('sorted', 'production', 'bulk_export', '00000000-0000-4000-8000-0000000000a1', 2, 2, 'ops-test', 'rollback test')$s$, '23514');
SELECT pg_temp.expect_fail('rollback with a stale expected revision is refused', $s$SELECT titan.feature_flag_rollback('supercharged', 'staging', 'ui_theme', NULL, 1, 1, 'ops-test', 'rollback test')$s$, '40001');
SELECT pg_temp.expect_fail('rollback needs an actor', $s$SELECT titan.feature_flag_rollback('supercharged', 'staging', 'ui_theme', NULL, 2, 1, '', 'rollback test')$s$, '23514');
SELECT pg_temp.expect_count('ui_theme is still at revision 2 after refused rollbacks',
  $s$SELECT 1 FROM titan.feature_flags WHERE flag_key = 'ui_theme' AND revision = 2$s$, 1);

-- Restore ui_theme to its revision 1 value (classic) at expected revision 2.
SELECT pg_temp.expect_count('rollback returns the new revision 3',
  $s$SELECT 1 WHERE titan.feature_flag_rollback('supercharged', 'staging', 'ui_theme', NULL, 2, 1, 'ops-test', 'restore classic after test') = 3$s$, 1);
SELECT pg_temp.expect_count('rollback restored the previous value (classic) at revision 3',
  $s$SELECT 1 FROM titan.feature_flags WHERE flag_key = 'ui_theme' AND revision = 3 AND value = '"classic"'$s$, 1);
SELECT pg_temp.expect_count('rollback is recorded as action rollback pointing at revision 1',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'ui_theme' AND action = 'rollback' AND revision = 3 AND rollback_to_revision = 1 AND actor = 'ops-test' AND snapshot->>'value' = 'classic'$s$, 1);

-- Rollback of an override to a non-expired revision restores the override value and expiry.
SELECT pg_temp.expect_count('org a override can be rolled back to its active revision 1 (rollback target)',
  $s$SELECT 1 WHERE titan.feature_flag_rollback('sorted', 'production', 'bulk_export', '00000000-0000-4000-8000-0000000000a1', 2, 1, 'ops-test', 'restore org a override') = 3$s$, 1);
SELECT pg_temp.expect_count('org a override is back to value true with a future expiry',
  $s$SELECT 1 FROM titan.feature_flags WHERE flag_key = 'bulk_export' AND product = 'sorted' AND environment = 'production' AND organisation_id = '00000000-0000-4000-8000-0000000000a1' AND revision = 3 AND value = 'true' AND expires_at > now()$s$, 1);

-- A later plain set is recorded as set again, not as a rollback (rollback marker is cleared).
SELECT pg_temp.expect_affected('plain set after rollback is recorded as set',
  $s$UPDATE titan.feature_flags SET value = '60', revision = revision + 1 WHERE flag_key = 'max_rows' AND product = 'lms' AND environment = 'production' AND revision = 1$s$, 1);
SELECT pg_temp.expect_count('plain set after rollback has action set, not rollback',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'max_rows' AND revision = 2 AND action = 'set' AND rollback_to_revision IS NULL$s$, 1);

-- ---------------------------------------------------------------- writer role can change a flag through the audit path
SET ROLE titan_trusted_writer;
SELECT pg_catalog.set_config('titan.change_actor', 'writer-test', true);
SELECT pg_catalog.set_config('titan.change_reason', 'writer path', true);
SELECT pg_temp.expect_affected('trusted writer inserts a scope (audited)', $s$INSERT INTO titan.feature_flags (product, environment, flag_key, flag_type, allowed_values, default_value, owner, value) VALUES ('central', 'production', 'writer_flag', 'boolean', '[true, false]', 'false', 'platform-team', 'false')$s$, 1);
RESET ROLE;
SELECT pg_temp.expect_count('writer change is in history with its own actor',
  $s$SELECT id FROM titan.feature_flag_history WHERE flag_key = 'writer_flag' AND actor = 'writer-test' AND action = 'create'$s$, 1);

ROLLBACK;
\echo feature flags: all checks passed (transaction rolled back)
