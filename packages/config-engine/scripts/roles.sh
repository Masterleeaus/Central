#!/usr/bin/env bash
set -euo pipefail
db="$1"
psql -X -v ON_ERROR_STOP=1 "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE titan_config_reader;
SELECT count(*) FROM titan_config.definitions;
SELECT count(*) FROM titan_config.scopes;
ROLLBACK;
BEGIN;
SET LOCAL ROLE titan_config_writer;
SELECT count(*) FROM titan_config.revisions;
ROLLBACK;
SQL
for command in \
 "INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value) VALUES('central','forbidden','ops','boolean','false')" \
 "UPDATE titan_config.revisions SET value='false'::jsonb" \
 "DELETE FROM titan_config.audit";do
 role=titan_config_writer
 case "$command" in INSERT*) role=titan_config_reader;;esac
 if psql -X -v ON_ERROR_STOP=1 "$db" >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE $role;
$command;
ROLLBACK;
SQL
 then echo "forbidden operation allowed: $command" >&2;exit 1;fi
done
echo "PostgreSQL restricted roles verified"
