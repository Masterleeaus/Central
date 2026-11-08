"""Login-role path test: runs tests/sql/login_role_path.sql against a real PostgreSQL database.

The database test runs only when both are available:
  * psql, found on PATH or given by the PSQL environment variable, and
  * TITAN_TEST_DATABASE_URL, a superuser URL for a database with migrations 0001-0009 applied.
Otherwise the database test is skipped and unittest prints the reason. Set TITAN_REQUIRE_DB_TESTS=1
to fail instead of skip; CI sets it so a missing database cannot pass silently.

Run locally:
  python3 tools/migrate.py --database-url "$TITAN_TEST_DATABASE_URL"
  TITAN_TEST_DATABASE_URL="$TITAN_TEST_DATABASE_URL" python3 -m unittest discover -s tests -p 'test_login_role_path.py' -v

The URL is passed to psql as an argument, so keep credentials out of it and use PGPASSFILE instead.
"""
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tests' / 'sql' / 'login_role_path.sql'
MARKER = 'login-role path: all checks passed'


def skip_reason():
    """Return why the database test cannot run, or None when it can."""
    if not (os.environ.get('PSQL') or shutil.which('psql')):
        return 'psql is not on PATH (set PSQL to its path)'
    if not os.environ.get('TITAN_TEST_DATABASE_URL'):
        return 'TITAN_TEST_DATABASE_URL is not set'
    return None


class LoginRoleScriptShapeTests(unittest.TestCase):
    """Always runs: the script is one transaction that rolls back and reports its marker."""

    def test_script_is_one_transaction_that_rolls_back(self):
        text = SCRIPT.read_text(encoding='utf-8')
        self.assertIn('\nBEGIN;\n', text)
        self.assertTrue(text.rstrip().endswith('ROLLBACK;'))
        self.assertIn(MARKER, text)
        self.assertIn('SET SESSION AUTHORIZATION titan_central_app', text)


class LoginRolePathDatabaseTests(unittest.TestCase):
    def test_login_role_path_against_database(self):
        reason = skip_reason()
        if reason:
            if os.environ.get('TITAN_REQUIRE_DB_TESTS') == '1':
                self.fail(f'database test required but cannot run: {reason}')
            self.skipTest(f'database test skipped: {reason}')
        psql = os.environ.get('PSQL') or shutil.which('psql')
        result = subprocess.run(
            [psql, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(SCRIPT), os.environ['TITAN_TEST_DATABASE_URL']],
            capture_output=True, text=True, timeout=300,
        )
        combined = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, combined[-4000:])
        self.assertIn(MARKER, combined)


if __name__ == '__main__':
    unittest.main()
