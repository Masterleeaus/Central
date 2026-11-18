"""Tests for tools/retention_purge.py (issue #16) and migrations 0028 and 0031. No database is used.

The job is exercised with a fake runner that records every SQL script. The database behaviour of migrations 0028
and 0031 (purger carve-out, RLS, append-only trigger, insert grant) is checked by tests/sql files run in CI.
"""
import importlib.util
import io
import re
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


purge = load('retention_purge', 'tools/retention_purge.py')
migrate = load('migrate', 'tools/migrate.py')
URL = 'postgresql://operator@example.invalid/titan'
CUTOFF = '2026-11-18 00:00:00.123456+00'
ACTIVITY_CSV = 'occurred_at,id\n2026-01-01 00:00:00+00,a1\n2026-01-02 00:00:00+00,a2\n'
AUDIT_CSV = 'created_at,id\n'


class FakeRunner:
    """Answers the table check, cutoff and dry-run queries, records exports and stores, and returns scripted DELETE counts."""

    def __init__(self, batches=None, tables_present=True, export_error=False, store_error=False, cutoff=CUTOFF):
        self.scripts = []
        self.batches = list(batches or [])
        self.tables_present = tables_present
        self.export_error = export_error
        self.store_error = store_error
        self.cutoff = cutoff

    def __call__(self, sql):
        self.scripts.append(sql)
        if 'to_regclass' in sql:
            return ''.join(f'{t.table}|{"t" if self.tables_present or t.table == "titan.activity_events" else "f"}\n'
                           for t in purge.TARGETS)
        if sql.startswith('SELECT (now()'):
            return f'{self.cutoff}\n'
        if 'INSERT INTO titan.retention_exports' in sql:
            if self.store_error:
                raise purge.PurgeError('psql failed; store refused')
            return ''
        if 'COPY (' in sql:
            if self.export_error:
                raise purge.PurgeError('psql failed; export refused')
            return ACTIVITY_CSV if 'activity_events' in sql else AUDIT_CSV
        if sql.startswith('BEGIN READ ONLY') and 'count(*)' in sql:
            return ('titan.activity_events|7|2026-01-01 00:00:00+00|2026-02-01 00:00:00+00\n'
                    'titan.provisioning_audit|0||\n')
        return f'{self.batches.pop(0) if self.batches else 0}\n'

    def deletes(self):
        return [s for s in self.scripts if 'DELETE FROM' in s]

    def exports(self):
        return [s for s in self.scripts if 'COPY (' in s]

    def stores(self):
        return [s for s in self.scripts if 'INSERT INTO titan.retention_exports' in s]


def run(argv, runner, env=None):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = purge.main(argv, runner=runner, env=env if env is not None else {})
    return code, out.getvalue(), err.getvalue()


class DefaultsAndValidation(unittest.TestCase):
    def test_default_retention_is_365_days_and_dry_run(self):
        args = purge.parse_args([])
        self.assertEqual(args.retention_days, 365)
        self.assertFalse(args.execute)

    def test_days_must_be_positive_integer(self):
        for bad in (0, -1, 3651, True, '90', 1.5):
            with self.subTest(bad=bad), self.assertRaises(purge.ConfigError):
                purge.validate_days(bad)
        self.assertEqual(purge.validate_days(90), 90)

    def test_batch_size_bounds(self):
        for bad in (0, 10001, False, 'x'):
            with self.subTest(bad=bad), self.assertRaises(purge.ConfigError):
                purge.validate_batch(bad)

    def test_cutoff_must_have_timestamp_shape(self):
        self.assertEqual(purge.validate_cutoff(CUTOFF), CUTOFF)
        for bad in ("2026-11-18 00:00:00+00'; DROP TABLE x; --", '', 'now()', '2026-11-18', None):
            with self.subTest(bad=bad), self.assertRaises(purge.PurgeError):
                purge.validate_cutoff(bad)

    def test_bad_cutoff_from_database_stops_before_any_delete(self):
        r = FakeRunner(cutoff="x'; DELETE FROM titan.activity_events; --")
        code, _, err = run(['--execute'], r)
        self.assertEqual(code, 1)
        self.assertEqual(r.deletes(), [])
        self.assertEqual(r.stores(), [])
        self.assertIn('database error', err)

    def test_bad_days_exit_2_without_touching_database(self):
        r = FakeRunner()
        code, _, err = run(['--retention-days', '0'], r)
        self.assertEqual(code, 2)
        self.assertIn('configuration error', err)
        self.assertEqual(r.scripts, [])

    def test_missing_url_exits_2_and_does_not_print_url(self):
        code, _, err = run([], None, env={})
        self.assertEqual(code, 2)
        self.assertIn(purge.URL_ENV, err)
        self.assertNotIn('postgresql://', err)


class DryRun(unittest.TestCase):
    def test_default_run_never_sends_delete_or_insert(self):
        r = FakeRunner()
        code, out, _ = run([], r)
        self.assertEqual(code, 0)
        self.assertEqual(r.deletes(), [])
        self.assertEqual(r.stores(), [])
        self.assertFalse(any(re.search(r'\b(DELETE|UPDATE|INSERT|TRUNCATE)\b', s) for s in r.scripts))
        self.assertIn('DRY RUN. Nothing was deleted', out)
        self.assertIn('titan.activity_events: 7 row(s) eligible', out)

    def test_dry_run_is_read_only_and_rolls_back(self):
        sql = purge.build_dry_run_sql(CUTOFF, purge.TARGETS)
        self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))

    def test_dry_run_skips_missing_tables(self):
        r = FakeRunner(tables_present=False)
        code, out, _ = run([], r)
        self.assertEqual(code, 0)
        dry = [s for s in r.scripts if s.startswith('BEGIN READ ONLY') and 'count(*)' in s][0]
        self.assertIn('titan.activity_events', dry)
        self.assertNotIn('titan.provisioning_audit', dry)


class Execute(unittest.TestCase):
    def exec_args(self, *extra):
        return ['--execute', *extra]

    def test_execute_deletes_in_batches_until_short_batch(self):
        r = FakeRunner(batches=[2, 2, 1, 0])  # batch size 2: stops after the batch of 1
        code, out, _ = run(self.exec_args('--batch-size', '2'), r)
        self.assertEqual(code, 0)
        activity = [s for s in r.deletes() if 'titan.activity_events' in s]
        self.assertEqual(len(activity), 3)
        self.assertIn('deleted 5 row(s) from titan.activity_events older than 365 days', out)

    def test_every_batch_sets_role_and_the_fixed_cutoff(self):
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        self.assertTrue(r.deletes())
        for s in r.deletes():
            self.assertTrue(s.startswith('BEGIN;'))
            self.assertIn('SET LOCAL ROLE titan_retention_purger;', s)
            self.assertIn(f"set_config('titan.retention_cutoff', '{CUTOFF}', true)", s)
            self.assertIn("current_setting('titan.retention_cutoff', true)", s)
            self.assertTrue(s.rstrip().endswith('COMMIT;'))

    def test_export_export_store_and_delete_all_use_one_cutoff(self):
        # Regression for the export/delete gap: each step used its own now(), so rows could age past the cutoff
        # between the export and the delete and be deleted without being exported.
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        steps = r.exports() + r.stores() + r.deletes()
        self.assertTrue(steps)
        for s in steps:
            self.assertIn(f"'{CUTOFF}'", s)
            self.assertNotIn('now()', s)
        self.assertEqual(sum(1 for s in r.scripts if s.startswith('SELECT (now()')), 1)

    def test_custom_retention_days_is_used_for_the_cutoff_query(self):
        r = FakeRunner(batches=[0])
        run(self.exec_args('--retention-days', '30'), r)
        self.assertIn('make_interval(days => 30)', [s for s in r.scripts if s.startswith('SELECT (now()')][0])

    def test_no_script_touches_unlisted_tables(self):
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        for s in r.deletes():
            self.assertTrue(any(t.table in s for t in purge.TARGETS))
            self.assertFalse(re.search(r'DROP|TRUNCATE|ALTER', s))

    def test_database_error_exits_1_without_leaking_url(self):
        def failing(sql):
            if 'to_regclass' in sql:
                return 'titan.activity_events|t\ntitan.provisioning_audit|t\n'
            if sql.startswith('SELECT (now()'):
                return f'{CUTOFF}\n'
            raise purge.PurgeError('psql failed; check the role membership and the migration 0028 state')
        code, _, err = run(self.exec_args(), failing)
        self.assertEqual(code, 1)
        self.assertNotIn('postgresql://', err)

    def test_execute_no_longer_takes_an_export_directory(self):
        # argparse rejects the removed flag with exit status 2 before any SQL is built.
        r = FakeRunner()
        with self.assertRaises(SystemExit) as ctx, redirect_stderr(io.StringIO()):
            purge.main(['--execute', '--export-dir', '/tmp/x'], runner=r, env={})
        self.assertEqual(ctx.exception.code, 2)
        self.assertEqual(r.scripts, [])

    def test_every_store_runs_before_the_first_delete(self):
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        first_delete = min(i for i, s in enumerate(r.scripts) if 'DELETE FROM' in s)
        last_store = max(i for i, s in enumerate(r.scripts) if 'INSERT INTO titan.retention_exports' in s)
        self.assertEqual(len(r.stores()), 2)
        self.assertLess(last_store, first_delete)

    def test_export_and_store_are_read_only_then_one_insert_each(self):
        r = FakeRunner(batches=[0, 0])
        code, out, _ = run(self.exec_args(), r)
        self.assertEqual(code, 0)
        self.assertEqual(len(r.exports()), 2)
        for s in r.exports():
            self.assertNotRegex(s, r'\b(DELETE|UPDATE|INSERT|TRUNCATE)\b')
            self.assertIn('ROLLBACK;', s)
        self.assertEqual(len(r.stores()), 2)
        for s in r.stores():
            self.assertIn('SET LOCAL ROLE titan_retention_purger;', s)
            self.assertNotRegex(s, r'\b(DELETE|UPDATE|TRUNCATE)\b')
        self.assertIn('stored 2 row(s) from titan.activity_events in titan.retention_exports', out)
        self.assertIn('stored 0 row(s) from titan.provisioning_audit', out)

    def test_store_carries_row_count_checksum_and_body(self):
        import hashlib
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        activity = [s for s in r.stores() if "'titan.activity_events'" in s][0]
        self.assertIn(", 2, '" + hashlib.sha256(ACTIVITY_CSV.encode('utf-8')).hexdigest() + "', $csv", activity)
        self.assertIn('occurred_at,id', activity)
        self.assertIn('2026-01-02 00:00:00+00,a2', activity)

    def test_store_body_uses_a_random_tag_per_script(self):
        t1 = purge.build_store_sql(CUTOFF, purge.TARGETS[0], 2, 'a' * 64, ACTIVITY_CSV)
        t2 = purge.build_store_sql(CUTOFF, purge.TARGETS[0], 2, 'a' * 64, ACTIVITY_CSV)
        self.assertNotEqual(re.search(r'\$(csv[0-9a-f]+)\$', t1).group(1), re.search(r'\$(csv[0-9a-f]+)\$', t2).group(1))

    def test_store_refuses_a_body_containing_its_own_tag(self):
        with mock.patch.object(purge.secrets, 'token_hex', return_value='deadbeefdeadbeef'):
            with self.assertRaises(purge.PurgeError):
                purge.build_store_sql(CUTOFF, purge.TARGETS[0], 1, 'a' * 64, 'x,$csvdeadbeefdeadbeef$\n')

    def test_empty_table_store_has_zero_rows(self):
        r = FakeRunner(batches=[0, 0])
        run(self.exec_args(), r)
        audit = [s for s in r.stores() if "'titan.provisioning_audit'" in s][0]
        self.assertIn(", 0, '", audit)
        self.assertIn('created_at,id', audit)

    def test_store_failure_stops_before_any_delete(self):
        r = FakeRunner(batches=[0, 0], store_error=True)
        code, _, err = run(self.exec_args(), r)
        self.assertEqual(code, 1)
        self.assertEqual(r.deletes(), [])
        self.assertIn('database error', err)

    def test_export_failure_stops_before_any_delete(self):
        r = FakeRunner(batches=[0, 0], export_error=True)
        code, _, err = run(self.exec_args(), r)
        self.assertEqual(code, 1)
        self.assertEqual(r.deletes(), [])
        self.assertEqual(r.stores(), [])
        self.assertIn('database error', err)

    def test_dry_run_writes_nothing(self):
        r = FakeRunner()
        code, _, _ = run([], r)
        self.assertEqual(code, 0)
        self.assertEqual(r.exports(), [])
        self.assertEqual(r.stores(), [])

    def test_run_psql_error_message_hides_url(self):
        import subprocess as sp
        original = sp.run
        try:
            sp.run = lambda *a, **k: sp.CompletedProcess(a, 3, stdout='', stderr=URL)
            with self.assertRaises(purge.PurgeError) as ctx:
                purge.run_psql(URL, 'SELECT 1;')
            self.assertNotIn(URL, str(ctx.exception))
        finally:
            sp.run = original


class MigrationZeroTwentyEight(unittest.TestCase):
    path = ROOT / 'migrations' / '0028_retention_purge.sql'

    def setUp(self):
        self.text = self.path.read_text()

    def test_framed_as_one_transaction_and_discovered(self):
        found = {m.version: m for m in migrate.discover(ROOT / 'migrations')}
        self.assertIn(28, found)
        self.assertEqual(found[28].name, 'retention_purge')

    def test_grants_only_to_purger(self):
        self.assertIn('CREATE ROLE titan_retention_purger NOLOGIN', self.text)
        self.assertIn('GRANT SELECT, DELETE ON titan.activity_events TO titan_retention_purger;', self.text)
        self.assertIn('GRANT SELECT, DELETE ON titan.provisioning_audit TO titan_retention_purger;', self.text)
        self.assertNotRegex(self.text, r'GRANT[^;]*TO (PUBLIC|titan_tenant_app|titan_trusted_writer|titan_trusted_reader)')

    def test_carve_out_is_narrow(self):
        self.assertIn("TG_OP = 'DELETE' AND pg_has_role(current_user, 'titan_retention_purger', 'MEMBER')", self.text)
        self.assertIn('OLD.occurred_at < cutoff_text::timestamptz', self.text)
        self.assertIn("RAISE EXCEPTION 'titan.activity_events is append-only", self.text)
        self.assertNotIn('FOR UPDATE', self.text)

    def test_policies_fail_closed_without_cutoff(self):
        self.assertIn("NULLIF(current_setting('titan.retention_cutoff', true), '')::timestamptz", self.text)

    def test_rollback_exists_and_restores_trigger(self):
        rb = (ROOT / 'database' / 'retention' / 'rollback_0028.sql').read_text()
        self.assertIn('DROP POLICY IF EXISTS activity_events_retention_delete', rb)
        self.assertNotIn('pg_has_role', rb)


class MigrationZeroThirtyOne(unittest.TestCase):
    path = ROOT / 'migrations' / '0031_retention_exports.sql'

    def setUp(self):
        self.text = self.path.read_text()

    def test_framed_as_one_transaction_and_discovered(self):
        found = {m.version: m for m in migrate.discover(ROOT / 'migrations')}
        self.assertIn(31, found)
        self.assertEqual(found[31].name, 'retention_exports')

    def test_insert_only_for_the_purger(self):
        self.assertIn('GRANT INSERT ON titan.retention_exports TO titan_retention_purger;', self.text)
        self.assertNotRegex(self.text, r'GRANT\s+(SELECT|UPDATE|DELETE|ALL)[^;]*retention_exports')
        self.assertIn('REVOKE ALL ON titan.retention_exports FROM PUBLIC;', self.text)

    def test_append_only_trigger_covers_update_delete_and_truncate(self):
        self.assertIn('BEFORE UPDATE OR DELETE ON titan.retention_exports', self.text)
        self.assertIn('BEFORE TRUNCATE ON titan.retention_exports', self.text)
        self.assertIn("RAISE EXCEPTION 'titan.retention_exports is append-only", self.text)

    def test_checksum_and_table_are_constrained(self):
        self.assertIn("CHECK (body_sha256 ~ '^[0-9a-f]{64}$')", self.text)
        self.assertIn("CHECK (table_name IN ('titan.activity_events', 'titan.provisioning_audit'))", self.text)

    def test_rollback_refuses_to_drop_rows(self):
        rb = (ROOT / 'database' / 'retention' / 'rollback_0031.sql').read_text()
        self.assertIn('rollback refused', rb)
        self.assertIn('DROP TABLE IF EXISTS titan.retention_exports', rb)
        self.assertIn('DELETE FROM public.schema_migrations WHERE version = 31;', rb)


if __name__ == '__main__':
    unittest.main()
