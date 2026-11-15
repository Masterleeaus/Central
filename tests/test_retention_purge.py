"""Tests for tools/retention_purge.py (issue #16) and migration 0028. No database is used.

The job is exercised with a fake runner that records every SQL script. The database behaviour of migration 0028
(purger carve-out, RLS, trigger) has no PostgreSQL test yet. That is a documented gap: add a tests/sql file and a CI step.
"""
import importlib.util
import io
import re
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


purge = load('retention_purge', 'tools/retention_purge.py')
migrate = load('migrate', 'tools/migrate.py')
URL = 'postgresql://operator@example.invalid/titan'


class FakeRunner:
    """Answers the table check and dry-run queries, and returns scripted counts for DELETE batches."""

    def __init__(self, batches=None, tables_present=True):
        self.scripts = []
        self.batches = list(batches or [])
        self.tables_present = tables_present

    def __call__(self, sql):
        self.scripts.append(sql)
        if 'to_regclass' in sql:
            return ''.join(f'{t.table}|{"t" if self.tables_present or t.table == "titan.activity_events" else "f"}\n'
                           for t in purge.TARGETS)
        if sql.startswith('BEGIN READ ONLY'):
            return ('titan.activity_events|7|2026-01-01 00:00:00+00|2026-02-01 00:00:00+00\n'
                    'titan.provisioning_audit|0||\n')
        return f'{self.batches.pop(0) if self.batches else 0}\n'

    def deletes(self):
        return [s for s in self.scripts if 'DELETE FROM' in s]


def run(argv, runner, env=None):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = purge.main(argv, runner=runner, env=env if env is not None else {})
    return code, out.getvalue(), err.getvalue()


class DefaultsAndValidation(unittest.TestCase):
    def test_default_retention_is_90_days_and_dry_run(self):
        args = purge.parse_args([])
        self.assertEqual(args.retention_days, 90)
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
    def test_default_run_never_sends_delete(self):
        r = FakeRunner()
        code, out, _ = run([], r)
        self.assertEqual(code, 0)
        self.assertEqual(r.deletes(), [])
        self.assertFalse(any(re.search(r'\b(DELETE|UPDATE|INSERT|TRUNCATE)\b', s) for s in r.scripts))
        self.assertIn('DRY RUN. Nothing was deleted', out)
        self.assertIn('titan.activity_events: 7 row(s) eligible', out)

    def test_dry_run_is_read_only_and_rolls_back(self):
        sql = purge.build_dry_run_sql(90, purge.TARGETS)
        self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))

    def test_dry_run_skips_missing_tables(self):
        r = FakeRunner(tables_present=False)
        code, out, _ = run([], r)
        self.assertEqual(code, 0)
        dry = [s for s in r.scripts if s.startswith('BEGIN READ ONLY')][0]
        self.assertIn('titan.activity_events', dry)
        self.assertNotIn('titan.provisioning_audit', dry)


class Execute(unittest.TestCase):
    def test_execute_deletes_in_batches_until_short_batch(self):
        r = FakeRunner(batches=[2, 2, 1, 0])  # batch size 2: stops after the batch of 1
        code, out, _ = run(['--execute', '--batch-size', '2'], r)
        self.assertEqual(code, 0)
        activity = [s for s in r.deletes() if 'titan.activity_events' in s]
        self.assertEqual(len(activity), 3)
        self.assertIn('deleted 5 row(s) from titan.activity_events older than 90 days', out)

    def test_every_batch_sets_cutoff_role_and_predicate(self):
        r = FakeRunner(batches=[0, 0])
        run(['--execute'], r)
        for s in r.deletes():
            self.assertTrue(s.startswith('BEGIN;'))
            self.assertIn('SET LOCAL ROLE titan_retention_purger;', s)
            self.assertIn("set_config('titan.retention_cutoff', (now() - make_interval(days => 90))::text, true)", s)
            self.assertIn("current_setting('titan.retention_cutoff', true)", s)
            self.assertTrue(s.rstrip().endswith('COMMIT;'))

    def test_custom_retention_days_is_used_in_cutoff(self):
        r = FakeRunner(batches=[0])
        run(['--execute', '--retention-days', '30'], r)
        self.assertTrue(any('make_interval(days => 30)' in s for s in r.deletes()))

    def test_no_script_touches_unlisted_tables(self):
        r = FakeRunner(batches=[0, 0])
        run(['--execute'], r)
        for s in r.deletes():
            self.assertTrue(any(t.table in s for t in purge.TARGETS))
            self.assertFalse(re.search(r'DROP|TRUNCATE|ALTER', s))

    def test_database_error_exits_1_without_leaking_url(self):
        def failing(sql):
            if 'to_regclass' in sql:
                return 'titan.activity_events|t\ntitan.provisioning_audit|t\n'
            raise purge.PurgeError('psql failed; check the role membership and the migration 0028 state')
        code, _, err = run(['--execute'], failing)
        self.assertEqual(code, 1)
        self.assertNotIn('postgresql://', err)

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


if __name__ == '__main__':
    unittest.main()
