#!/usr/bin/env python3
"""Single authoritative runner for the canonical Titan shared-company chain.

Usage:
  python3 tools/migrate_shared.py --database-url postgresql://...
  python3 tools/migrate_shared.py --database-url postgresql://... --dry-run

Only database/migrations/NNNN_*.sql is considered. The separate legacy
/migrations chain must NEVER be applied to this database.

Each migration is one transaction. A durable checksum is recorded in
titan.schema_migrations *inside* the migration's transaction, so a failed
migration cannot appear applied. The first migration creates the registry.
A transaction-scoped advisory lock serialises concurrent migrators.
"""
import argparse
import sys
from pathlib import Path

from migrate import (
    MigrationError, PsqlClient, discover, _statement_lines,
    BEGIN_RE, COMMIT_RE, LOCK_KEY,  # retain original migration parser/runner
)

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / 'database' / 'migrations'
REGISTRY = 'titan.schema_migrations'
SHARED_LOCK = LOCK_KEY + 25002

class SharedMigrationError(MigrationError):
    pass

def _sql_text(value):
    return "'" + value.replace("'", "''") + "'"

def validate_chain(files):
    if not files or [m.version for m in files] != list(range(1, len(files) + 1)):
        raise SharedMigrationError('canonical migrations must start at 0001 and have no gaps')
    if files[0].name != 'shared_company_core':
        raise SharedMigrationError('unexpected canonical migration 0001')
    if 'CREATE TABLE titan.schema_migrations' not in files[0].text:
        raise SharedMigrationError('canonical migration 0001 must create titan.schema_migrations')

def _int(value):
    if type(value) is not int or value < 0:
        raise SharedMigrationError('invalid migration version')
    return value

def inspect(client):
    """Read without bootstrapping or mutating a database not yet approved."""
    rows = client.query_rows(
        "SELECT CASE WHEN to_regclass('titan.schema_migrations') IS NULL THEN 0 ELSE 1 END")
    if rows != [['0']] and rows != [['1']]:
        raise SharedMigrationError('cannot determine canonical migration registry')
    if rows == [['0']]:
        # A legacy Central database has titan.identities, but no canonical
        # registry. Never infer company IDs, rename tables, or drop anything.
        collisions = client.query_rows(
            "SELECT CASE WHEN to_regclass('titan.identities') IS NOT NULL OR "
            "to_regclass('titan.organisations') IS NOT NULL OR "
            "to_regclass('public.schema_migrations') IS NOT NULL "
            "THEN 1 ELSE 0 END")
        if collisions != [['0']]:
            raise SharedMigrationError('existing legacy or unknown schema: migration refused')
        return {}
    applied = client.query_rows(
        'SELECT migration_id, checksum_sha256 FROM titan.schema_migrations ORDER BY migration_id')
    result = {}
    for mid, checksum in applied:
        if not isinstance(mid, str) or len(mid) < 6 or mid[:4].isdigit() is False or mid[4] != '_' or not isinstance(checksum, str):
            raise SharedMigrationError('invalid canonical migration registry entry')
        version = int(mid[:4])
        if version in result:
            raise SharedMigrationError('duplicate canonical migration version')
        result[version] = (mid, checksum)
    return result

def plan(files, applied):
    known = {m.version: m for m in files}
    for version, (identity, checksum) in applied.items():
        file = known.get(version)
        if file is None:
            raise SharedMigrationError(f'applied canonical migration {version:04d} has no file')
        if identity != f'{version:04d}_{file.name}' or checksum != file.checksum:
            raise SharedMigrationError(f'canonical migration {version:04d} checksum or filename drift')
    pending = [m for m in files if m.version not in applied]
    if pending and applied and pending[0].version < max(applied):
        raise SharedMigrationError('out-of-order canonical migration')
    return pending

def render(migration):
    """Build atomic advisory lock, collision check and registry record."""
    source = migration.text.splitlines(keepends=True)
    first = next(i for i, line in enumerate(source) if BEGIN_RE.match(line))
    last = max(i for i, line in enumerate(source) if COMMIT_RE.match(line))
    identity = f'{migration.version:04d}_{migration.name}'
    guard = (
        f'SELECT pg_advisory_xact_lock({SHARED_LOCK});\n'
        "DO $canonical_guard$ BEGIN\n"
        " IF to_regclass('titan.schema_migrations') IS NOT NULL THEN\n"
        f"  IF EXISTS (SELECT 1 FROM titan.schema_migrations WHERE migration_id={_sql_text(identity)}) "
        "THEN RAISE EXCEPTION 'canonical migration already applied'; END IF;\n"
        " END IF;\n"
        "END $canonical_guard$;\n"
    )
    record = (
        f'INSERT INTO {REGISTRY} (migration_id, checksum_sha256) VALUES '
        f'({_sql_text(identity)},{_sql_text(migration.checksum)});\n'
    )
    result = []
    for i, line in enumerate(source):
        if i == first:
            result.append(line)
            result.append(guard)
            continue
        if i == last:
            result.append(record)
        result.append(line)
    return ''.join(result)

def run(client, migrations_dir=CANONICAL, dry_run=False):
    # This runner intentionally accepts ONLY the canonical chain directory,
    # not an arbitrary migration source supplied from command line.
    if Path(migrations_dir).resolve() != CANONICAL.resolve():
        raise SharedMigrationError('only canonical database/migrations may be executed')
    files = discover(CANONICAL)
    validate_chain(files)
    pending = plan(files, inspect(client))
    if dry_run:
        return [m.version for m in pending]
    done = []
    for migration in pending:
        client.execute(render(migration))
        done.append(migration.version)
    return done

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--psql', default='psql')
    args = parser.parse_args(argv)
    try:
        versions = run(PsqlClient(args.database_url, args.psql), dry_run=args.dry_run)
    except (MigrationError, SharedMigrationError) as error:
        print(f'canonical migration error: {error}', file=sys.stderr)
        return 1
    verb = 'would apply' if args.dry_run else 'applied'
    print(f'{verb} {len(versions)} canonical migration(s)' +
          (': ' + ' '.join(f'{v:04d}' for v in versions) if versions else ''))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
