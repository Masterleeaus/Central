"""Stub-client tests for tools/migrate.py: ordering, idempotency, checksums, failure recovery.

The real database behaviour is covered by CI, which runs tools/migrate.py and
tests/sql/rls_two_tenant.sql against a PostgreSQL service container.
"""
import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('migrate', ROOT / 'tools' / 'migrate.py')
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)

RECORD_RE = re.compile(r"INSERT INTO public\.schema_migrations \(version, name, checksum\) VALUES \((\d+), '([^']+)', '([0-9a-f]+)'\);")
MIGRATION_TEXT = "BEGIN;\nCREATE TABLE t_{n} (id int);\nCOMMIT;\n"


class FakeClient:
    """Stands in for psql. A script is atomic: it either records its version or raises and records nothing."""

    def __init__(self, rows=None, fail_on=None):
        self.rows = dict(rows or {})
        self.fail_on = fail_on
        self.executed = []

    def execute(self, script):
        if migrate.BOOTSTRAP_SQL in script:
            return
        if self.fail_on and self.fail_on in script:
            raise migrate.MigrationError('psql failed (simulated)')
        self.executed.append(script)
        match = RECORD_RE.search(script)
        if match:
            self.rows[int(match.group(1))] = (match.group(2), match.group(3))

    def query_rows(self, sql):
        assert 'FROM public.schema_migrations' in sql
        return [[str(v), name, checksum] for v, (name, checksum) in sorted(self.rows.items())]


def write_dir(files):
    tmp = tempfile.TemporaryDirectory()
    for name, text in files.items():
        (Path(tmp.name) / name).write_text(text, encoding='utf-8')
    return tmp


class RealMigrationsTests(unittest.TestCase):
    def test_all_repository_migrations_are_one_transaction(self):
        found = migrate.discover(ROOT / 'migrations')
        self.assertEqual([m.version for m in found], [1, 2, 3, 4, 5, 6, 7, 8, 9, 16])
        for m in found:
            self.assertIn('COMMIT;', m.text, m.name)

    def test_repository_migrations_apply_in_order_then_are_noop(self):
        client = FakeClient()
        self.assertEqual(migrate.run(client, ROOT / 'migrations'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 16])
        self.assertEqual(migrate.run(client, ROOT / 'migrations'), [])
        self.assertEqual(len(client.executed), 10)

    def test_migration_0016_grants_only_to_the_trusted_writer(self):
        text = (ROOT / 'migrations' / '0016_organisation_selection.sql').read_text(encoding='utf-8')
        sql = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('--'))
        statements = [' '.join(part.split()) for part in sql.split(';')]
        grants = [stmt for stmt in statements if stmt.startswith('GRANT')]
        self.assertEqual(len(grants), 4)
        for grant in grants:
            self.assertTrue(grant.endswith('TO titan_trusted_writer'), grant)
        for role in ('titan_tenant_app', 'titan_trusted_reader', 'titan_central_app'):
            self.assertNotIn(role, sql)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = write_dir({
            '0001_first.sql': MIGRATION_TEXT.format(n=1),
            '0002_second.sql': MIGRATION_TEXT.format(n=2),
            '0003_third.sql': MIGRATION_TEXT.format(n=3),
        })
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fresh_database_applies_in_ascending_order(self):
        client = FakeClient()
        self.assertEqual(migrate.run(client, self.dir), [1, 2, 3])
        self.assertEqual(sorted(client.rows), [1, 2, 3])
        self.assertIn('CREATE TABLE t_1', client.executed[0])
        self.assertIn('CREATE TABLE t_3', client.executed[2])

    def test_second_run_applies_nothing_and_executes_nothing(self):
        client = FakeClient()
        migrate.run(client, self.dir)
        before = len(client.executed)
        self.assertEqual(migrate.run(client, self.dir), [])
        self.assertEqual(len(client.executed), before)

    def test_dry_run_reports_pending_without_executing(self):
        client = FakeClient()
        self.assertEqual(migrate.run(client, self.dir, dry_run=True), [1, 2, 3])
        self.assertEqual(client.executed, [])
        self.assertEqual(client.rows, {})

    def test_failure_leaves_no_record_and_rerun_resumes(self):
        client = FakeClient(fail_on="'third'")
        with self.assertRaises(migrate.MigrationError):
            migrate.run(client, self.dir)
        self.assertEqual(sorted(client.rows), [1, 2])
        client.fail_on = None
        self.assertEqual(migrate.run(client, self.dir), [3])
        self.assertEqual(sorted(client.rows), [1, 2, 3])

    def test_out_of_order_pending_version_is_refused(self):
        checksum = migrate.discover(self.dir)[0].checksum
        client = FakeClient(rows={1: ('first', checksum), 3: ('third', migrate.discover(self.dir)[2].checksum)})
        with self.assertRaisesRegex(migrate.MigrationError, 'out-of-order'):
            migrate.run(client, self.dir)
        self.assertEqual(client.executed, [])

    def test_changed_applied_file_is_refused(self):
        client = FakeClient(rows={1: ('first', '0' * 64)})
        with self.assertRaisesRegex(migrate.MigrationError, 'checksum mismatch'):
            migrate.run(client, self.dir)
        self.assertEqual(client.executed, [])

    def test_applied_version_without_file_is_refused(self):
        client = FakeClient(rows={9: ('gone', '0' * 64)})
        with self.assertRaisesRegex(migrate.MigrationError, 'has no file'):
            migrate.run(client, self.dir)

    def test_rendered_script_guards_after_begin_and_records_before_commit(self):
        m = migrate.discover(self.dir)[0]
        script = migrate.render(m)
        lines = script.splitlines()
        self.assertEqual(lines[0], 'BEGIN;')
        self.assertIn('pg_advisory_xact_lock', lines[1])
        self.assertIn('already applied', lines[2])
        record_at = next(i for i, line in enumerate(lines) if line.startswith('INSERT INTO public.schema_migrations'))
        self.assertEqual(lines[record_at + 1], 'COMMIT;')
        self.assertEqual(script.count('COMMIT;'), 1)

    def test_migration_must_be_wrapped_in_begin_and_commit(self):
        for text in ("CREATE TABLE x (id int);\nCOMMIT;\n", "BEGIN;\nCREATE TABLE x (id int);\n"):
            tmp = write_dir({'0001_bad.sql': text})
            try:
                with self.assertRaises(migrate.MigrationError):
                    migrate.discover(Path(tmp.name))
            finally:
                tmp.cleanup()

    def test_duplicate_version_and_bad_names_are_refused(self):
        tmp = write_dir({'0001_a.sql': MIGRATION_TEXT.format(n=1), '0001_b.sql': MIGRATION_TEXT.format(n=2)})
        try:
            with self.assertRaisesRegex(migrate.MigrationError, 'duplicate'):
                migrate.discover(Path(tmp.name))
        finally:
            tmp.cleanup()
        tmp = write_dir({'first.sql': MIGRATION_TEXT.format(n=1)})
        try:
            with self.assertRaisesRegex(migrate.MigrationError, 'invalid migration file name'):
                migrate.discover(Path(tmp.name))
        finally:
            tmp.cleanup()

    def test_main_reports_errors_with_nonzero_exit(self):
        code = migrate.main(['--database-url', 'postgresql://x/y', '--psql', str(self.dir / 'no-such-psql'),
                             '--migrations-dir', str(self.dir)])
        self.assertEqual(code, 1)


if __name__ == '__main__':
    unittest.main()
