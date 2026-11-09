#!/usr/bin/env bash
set -euo pipefail
db="$1"
psql -X -v ON_ERROR_STOP=1 "$db" -f packages/config-engine/sql/concurrency_setup.sql
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# First writer holds the row, then commits revision one.
psql -X -v ON_ERROR_STOP=1 "$db" >"$tmp/first" 2>&1 <<'SQL' &
BEGIN;
SELECT revision FROM titan_config.scopes WHERE key='parallel_fixture' FOR UPDATE;
SELECT pg_sleep(1);
INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
VALUES('central','parallel_fixture','staging','environment','*',1,'true',100,'a','first writer','set');
UPDATE titan_config.scopes SET revision=1 WHERE key='parallel_fixture';
INSERT INTO titan_config.audit(product,key,environment,kind,scope,revision,actor,reason,action,correlation_id)
VALUES('central','parallel_fixture','staging','environment','*',1,'a','first writer','set','first');
COMMIT;
SQL
first=$!
sleep 0.3
# A second transaction blocks behind the first and then must reject stale version.
psql -X -v ON_ERROR_STOP=1 "$db" >"$tmp/second" 2>&1 <<'SQL' &
BEGIN;
SELECT revision FROM titan_config.scopes WHERE key='parallel_fixture' FOR UPDATE;
DO $$
BEGIN
 IF (SELECT revision FROM titan_config.scopes WHERE key='parallel_fixture')<>0 THEN
  RAISE EXCEPTION 'expected_revision_conflict';
 END IF;
END $$;
ROLLBACK;
SQL
second=$!
wait "$first"
if wait "$second";then
 echo "stale writer unexpectedly succeeded" >&2;exit 1
fi
grep -q 'expected_revision_conflict' "$tmp/second"
psql -X -v ON_ERROR_STOP=1 "$db" -f packages/config-engine/sql/concurrency_assert.sql
echo "PostgreSQL concurrency verified"
