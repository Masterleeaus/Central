#!/usr/bin/env python3
"""Retention purge for access-decision and audit rows older than a cutoff (issue #16).

Targets
  titan.activity_events     access decisions and other activity rows (occurred_at)
  titan.provisioning_audit  provisioning audit rows (created_at)
Health probe results are not stored in any table, so there is nothing to purge for them.

Default is DRY RUN. The job reads counts and oldest/newest timestamps and deletes nothing.
Rows are deleted only when --execute is passed. There is no other way to delete rows.
The default retention is 365 days (owner decision: 1 year).

Usage
  TITAN_RETENTION_DATABASE_URL=postgresql://... python3 tools/retention_purge.py            # dry run
  TITAN_RETENTION_DATABASE_URL=postgresql://... python3 tools/retention_purge.py --execute --export-dir DIR  # export, then delete

How it works
  * --execute requires --export-dir. Before any DELETE, every row older than the cutoff in each target
    table is written to a new CSV file in that directory (mode 0600, created with O_EXCL so an existing
    export is never overwritten). If any export fails, the job stops and deletes nothing.
  * Each batch is one transaction. It runs SET LOCAL ROLE titan_retention_purger, sets the cutoff
    (now() - retention days) with set_config(..., true), then deletes at most --batch-size rows.
  * The database enforces the cutoff too (migration 0028): the purger role can delete only rows older
    than titan.retention_cutoff, and the append-only trigger allows nothing else.
  * The cutoff is computed by the database clock, so every batch uses the same rule.
  * The operator login must be a member of titan_retention_purger. Without membership the job stops
    with a clear error and deletes nothing.
  * psql is the SQL client (as in tools/migrate.py), run with ON_ERROR_STOP=1.
  * Put the URL in the environment, not on the command line, so it stays out of shell history.

Exit codes: 0 done, 1 database error, 2 bad configuration.
"""
import argparse
import csv
import io
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass

DEFAULT_RETENTION_DAYS = 365
MAX_RETENTION_DAYS = 3650
DEFAULT_BATCH_SIZE = 1000
MAX_BATCH_SIZE = 10000
URL_ENV = 'TITAN_RETENTION_DATABASE_URL'
ROLE = 'titan_retention_purger'
CUTOFF_GUC = 'titan.retention_cutoff'


class ConfigError(ValueError):
    pass


class PurgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Target:
    table: str
    timestamp_column: str


TARGETS = (
    Target('titan.activity_events', 'occurred_at'),
    Target('titan.provisioning_audit', 'created_at'),
)


def validate_days(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_RETENTION_DAYS:
        raise ConfigError(f'retention days must be an integer from 1 to {MAX_RETENTION_DAYS}')
    return value


def validate_batch(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_BATCH_SIZE:
        raise ConfigError(f'batch size must be an integer from 1 to {MAX_BATCH_SIZE}')
    return value


def _setup(days: int) -> str:
    # days is a validated int, so interpolating it is safe.
    return (
        f'SET LOCAL ROLE {ROLE};\n'
        f"SELECT set_config('{CUTOFF_GUC}', (now() - make_interval(days => {days}))::text, true) AS _cutoff \\gset _\n"
    )


def build_dry_run_sql(days: int, targets) -> str:
    lines = ['BEGIN READ ONLY;', _setup(days)]
    for t in targets:
        lines.append(
            f"SELECT '{t.table}', count(*), coalesce(min({t.timestamp_column})::text, ''), "
            f"coalesce(max({t.timestamp_column})::text, '') FROM {t.table} "
            f"WHERE {t.timestamp_column} < NULLIF(current_setting('{CUTOFF_GUC}', true), '')::timestamptz;"
        )
    lines.append('ROLLBACK;')
    return '\n'.join(lines) + '\n'


def build_batch_sql(days: int, target: Target, batch_size: int) -> str:
    col = target.timestamp_column
    return (
        'BEGIN;\n'
        + _setup(days)
        + f"WITH victims AS (SELECT ctid FROM {target.table} "
        f"WHERE {col} < NULLIF(current_setting('{CUTOFF_GUC}', true), '')::timestamptz "
        f"ORDER BY {col} LIMIT {batch_size}), "
        f"removed AS (DELETE FROM {target.table} t USING victims v WHERE t.ctid = v.ctid RETURNING 1) "
        "SELECT count(*) FROM removed;\n"
        'COMMIT;\n'
    )


def build_export_sql(days: int, target: Target) -> str:
    # Read-only: the export never changes a row. COPY writes CSV with a header to stdout.
    col = target.timestamp_column
    return (
        'BEGIN READ ONLY;\n'
        + _setup(days)
        + f"COPY (SELECT * FROM {target.table} "
        f"WHERE {col} < NULLIF(current_setting('{CUTOFF_GUC}', true), '')::timestamptz "
        f"ORDER BY {col}) TO STDOUT WITH (FORMAT csv, HEADER true);\n"
        'ROLLBACK;\n'
    )


def ensure_export_dir(path: str) -> None:
    try:
        os.makedirs(path, mode=0o700, exist_ok=True)
    except OSError as exc:
        raise PurgeError(f'export directory could not be created ({type(exc).__name__}); nothing was deleted') from exc
    if not os.path.isdir(path):
        raise PurgeError('export directory is not a directory; nothing was deleted')


def export_targets(runner, days: int, targets, export_dir: str) -> list:
    """Write every eligible row of each target to a new 0600 CSV file. Runs before any DELETE.

    Returns one dict per target: table, path, rows. Any failure raises PurgeError, and the caller
    must not delete anything.
    """
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    results = []
    for t in targets:
        csv_text = runner(build_export_sql(days, t))
        rows = sum(1 for _ in csv.reader(io.StringIO(csv_text))) - 1
        if rows < 0:
            raise PurgeError(f'export of {t.table} produced no header; nothing was deleted')
        path = os.path.join(export_dir, f"{t.table.replace('.', '_')}-{stamp}.csv")
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as fh:
                fh.write(csv_text)
        except OSError as exc:
            raise PurgeError(f'could not write export file for {t.table} ({type(exc).__name__}); nothing was deleted') from exc
        results.append({'table': t.table, 'path': path, 'rows': rows})
    return results


def build_table_check_sql() -> str:
    names = ', '.join(f"'{t.table}'" for t in TARGETS)
    return (
        "SELECT name, to_regclass(name) IS NOT NULL FROM unnest(ARRAY["
        + names
        + "]::text[]) AS name;\n"
    )


def run_psql(url: str, sql: str) -> str:
    try:
        proc = subprocess.run(
            ['psql', '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', url, '-f', '-'],
            input=sql, capture_output=True, text=True, timeout=600, check=False,
        )
    except FileNotFoundError as exc:
        raise PurgeError('psql is not installed') from exc
    if proc.returncode != 0:
        # Report the error class only. psql output can echo the connection string.
        raise PurgeError('psql failed; check the role membership and the migration 0028 state')
    return proc.stdout


def existing_targets(runner) -> list:
    out = runner(build_table_check_sql())
    present = {}
    for line in out.splitlines():
        if '|' in line:
            name, flag = line.split('|', 1)
            present[name.strip()] = flag.strip() == 't'
    return [t for t in TARGETS if present.get(t.table)]


def dry_run(runner, days: int, targets) -> list:
    lines = []
    out = runner(build_dry_run_sql(days, targets))
    for line in out.splitlines():
        parts = line.split('|')
        if len(parts) == 4:
            lines.append({'table': parts[0], 'count': int(parts[1]), 'oldest': parts[2], 'newest': parts[3]})
    return lines


def execute(runner, days: int, batch_size: int, targets, export_dir: str) -> tuple:
    # Phase 1: export every eligible row of every target. Phase 2 runs only if phase 1 succeeded.
    exported = export_targets(runner, days, targets, export_dir)
    totals = {}
    for t in targets:
        total = 0
        while True:
            out = runner(build_batch_sql(days, t, batch_size)).strip().splitlines()
            deleted = int(out[-1]) if out and out[-1].strip().isdigit() else 0
            total += deleted
            if deleted < batch_size:
                break
        totals[t.table] = total
    return exported, totals


def parse_args(argv):
    p = argparse.ArgumentParser(description='Purge access-decision and audit rows older than the retention period. Dry run unless --execute.')
    p.add_argument('--execute', action='store_true', help='delete rows. Without this flag nothing is deleted.')
    p.add_argument('--export-dir', default='', help='required with --execute: directory for the pre-delete CSV exports (created 0700 if missing)')
    p.add_argument('--retention-days', type=int, default=DEFAULT_RETENTION_DAYS, help=f'default {DEFAULT_RETENTION_DAYS}')
    p.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE, help=f'rows per transaction, 1 to {MAX_BATCH_SIZE}')
    return p.parse_args(argv)


def main(argv=None, runner=None, env=None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    env = os.environ if env is None else env
    try:
        days = validate_days(args.retention_days)
        batch = validate_batch(args.batch_size)
    except ConfigError as exc:
        print(f'configuration error: {exc}', file=sys.stderr)
        return 2
    if args.execute and not args.export_dir:
        print('configuration error: --execute needs --export-dir (rows are exported before any delete)', file=sys.stderr)
        return 2
    url = env.get(URL_ENV, '')
    if runner is None:
        if not url:
            print(f'configuration error: set {URL_ENV} (the URL is not printed)', file=sys.stderr)
            return 2
        runner = lambda sql: run_psql(url, sql)  # noqa: E731
    try:
        targets = existing_targets(runner)
        if not args.execute:
            rows = dry_run(runner, days, targets)
            print(f'DRY RUN. Nothing was deleted. Cutoff: rows older than {days} days (database clock).')
            for r in rows:
                print(f"{r['table']}: {r['count']} row(s) eligible; oldest {r['oldest'] or '-'}, newest {r['newest'] or '-'}")
            print('Re-run with --execute --export-dir DIR to export and then delete these rows.')
            return 0
        if not targets:
            print('no target tables exist; nothing to purge')
            return 0
        ensure_export_dir(args.export_dir)
        exported, totals = execute(runner, days, batch, targets, args.export_dir)
        for e in exported:
            print(f"exported {e['rows']} row(s) from {e['table']} to {e['path']} before any delete")
        for name, n in totals.items():
            print(f'deleted {n} row(s) from {name} older than {days} days')
        return 0
    except PurgeError as exc:
        print(f'database error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
