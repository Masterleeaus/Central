#!/usr/bin/env python3
"""Forward-only migration runner for the Titan Central database.

Usage:
  python3 tools/migrate.py --database-url postgresql://... [--dry-run]
  python3 tools/migrate.py --database-url postgresql://... --migrations-dir migrations

How it works
  * Migrations are migrations/NNNN_name.sql, NNNN a unique integer (applied in ascending order).
  * Every migration file must be one transaction: its first statement is BEGIN; and its last
    statement is COMMIT;. The runner refuses files that do not follow this rule.
  * The runner records each applied migration in public.schema_migrations
    (version, name, checksum, applied_at). It inserts the record inside the migration's own
    transaction, just before the final COMMIT, so the schema change and its record commit together.
  * Before applying anything the runner checks that every applied version still matches its file
    checksum (sha256 of the file as written) and that no pending version is lower than an applied one.
  * A per-migration advisory transaction lock plus a guard that the version is not yet recorded
    stops two concurrent runners from applying the same migration twice.
  * Re-running is safe: applied versions are skipped and only pending ones are executed.

The SQL client is psql (run with ON_ERROR_STOP=1), so the database URL is passed to psql.
Avoid putting credentials in shell history; prefer PGPASSFILE or a URL without a password.
"""
import argparse
import hashlib
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

BOOTSTRAP_SQL = (
    "CREATE TABLE IF NOT EXISTS public.schema_migrations ("
    "version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, "
    "applied_at timestamptz NOT NULL DEFAULT now());"
)
LOCK_KEY = 884201
FILE_RE = re.compile(r'^(\d{4})_([a-z0-9_]+)\.sql$')
BEGIN_RE = re.compile(r'^\s*BEGIN;\s*$', re.IGNORECASE)
COMMIT_RE = re.compile(r'^\s*COMMIT;\s*$', re.IGNORECASE)


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    text: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.text.encode('utf-8')).hexdigest()


def discover(directory: Path) -> list[Migration]:
    found: dict[int, Migration] = {}
    for path in sorted(directory.iterdir()):
        if not path.is_file() or not path.name.endswith('.sql'):
            continue
        match = FILE_RE.match(path.name)
        if not match:
            raise MigrationError(f'invalid migration file name: {path.name}')
        version = int(match.group(1))
        if version in found:
            raise MigrationError(f'duplicate migration version {version:04d}: {path.name}')
        text = path.read_text(encoding='utf-8')
        _check_transaction_shape(path.name, text)
        found[version] = Migration(version, match.group(2), path, text)
    return [found[v] for v in sorted(found)]


def _statement_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith('--')]


def _check_transaction_shape(name: str, text: str) -> None:
    lines = _statement_lines(text)
    if not lines or not BEGIN_RE.match(lines[0]):
        raise MigrationError(f'{name}: first statement must be BEGIN;')
    if not COMMIT_RE.match(lines[-1]):
        raise MigrationError(f'{name}: last statement must be COMMIT;')
    if sum(1 for line in lines if BEGIN_RE.match(line)) != 1:
        raise MigrationError(f'{name}: exactly one BEGIN; is required')
    if sum(1 for line in lines if COMMIT_RE.match(line)) != 1:
        raise MigrationError(f'{name}: exactly one COMMIT; is required')


def render(migration: Migration) -> str:
    """Return the script to execute: guard after BEGIN, version record before COMMIT."""
    out: list[str] = []
    lines = migration.text.splitlines(keepends=True)
    begin_index = next(i for i, line in enumerate(lines) if BEGIN_RE.match(line))
    commit_index = max(i for i, line in enumerate(lines) if COMMIT_RE.match(line))
    guard = (
        f"SELECT pg_advisory_xact_lock({LOCK_KEY});\n"
        f"DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = {migration.version}) "
        f"THEN RAISE EXCEPTION 'migration {migration.version:04d} already applied'; END IF; END $guard$;\n"
    )
    record = (
        "INSERT INTO public.schema_migrations (version, name, checksum) VALUES "
        f"({migration.version}, '{migration.name}', '{migration.checksum}');\n"
    )
    for i, line in enumerate(lines):
        if i == begin_index:
            out.append(line)
            out.append(guard)
            continue
        if i == commit_index:
            out.append(record)
        out.append(line)
    return ''.join(out)


class PsqlClient:
    def __init__(self, database_url: str, psql: str = 'psql'):
        self.database_url = database_url
        self.psql = psql

    def _run(self, args: list[str], stdin: str | None = None) -> str:
        try:
            proc = subprocess.run(
                [self.psql, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', self.database_url, *args],
                input=stdin, capture_output=True, text=True,
            )
        except OSError as error:
            raise MigrationError(f'cannot run {self.psql}: {error}') from error
        if proc.returncode != 0:
            raise MigrationError(f'psql failed (exit {proc.returncode}): {proc.stderr.strip()}')
        return proc.stdout

    def execute(self, script: str) -> None:
        self._run(['-f', '-'], stdin=script)

    def query_rows(self, sql: str) -> list[list[str]]:
        out = self._run(['-A', '-t', '-F', '\t', '-c', sql])
        return [line.split('\t') for line in out.splitlines() if line]


def applied_versions(client) -> dict[int, tuple[str, str]]:
    client.execute(BOOTSTRAP_SQL)
    rows = client.query_rows('SELECT version, name, checksum FROM public.schema_migrations ORDER BY version')
    return {int(v): (name, checksum) for v, name, checksum in rows}


def plan(migrations: list[Migration], applied: dict[int, tuple[str, str]]) -> list[Migration]:
    by_version = {m.version: m for m in migrations}
    for version, (name, checksum) in applied.items():
        current = by_version.get(version)
        if current is None:
            raise MigrationError(f'applied migration {version:04d} has no file in the migrations directory')
        if current.checksum != checksum:
            raise MigrationError(f'applied migration {version:04d} ({name}) changed on disk; checksum mismatch')
    pending = [m for m in migrations if m.version not in applied]
    if pending and applied and pending[0].version < max(applied):
        raise MigrationError(
            f'out-of-order: pending {pending[0].version:04d} is below applied {max(applied):04d}'
        )
    return pending


def run(client, migrations_dir: Path, dry_run: bool = False) -> list[int]:
    migrations = discover(migrations_dir)
    pending = plan(migrations, applied_versions(client))
    if dry_run:
        return [m.version for m in pending]
    done: list[int] = []
    for migration in pending:
        client.execute(render(migration))
        done.append(migration.version)
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--database-url', required=True)
    parser.add_argument('--migrations-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'migrations')
    parser.add_argument('--psql', default='psql')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    try:
        versions = run(PsqlClient(args.database_url, args.psql), args.migrations_dir, args.dry_run)
    except MigrationError as error:
        print(f'migration error: {error}', file=sys.stderr)
        return 1
    verb = 'would apply' if args.dry_run else 'applied'
    print(f'{verb} {len(versions)} migration(s)' + (': ' + ' '.join(f'{v:04d}' for v in versions) if versions else ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
