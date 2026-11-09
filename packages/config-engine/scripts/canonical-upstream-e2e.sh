#!/usr/bin/env bash
set -euo pipefail
upstream="$1"
test "$(git -C "$upstream" rev-parse HEAD)" = "$CANONICAL_COMPANY_PIN"
test -f "$upstream/database/migrations/0001_shared_company_core.sql"
db="$(printf '%s' "$CONFIG_TEST_DATABASE_URL" | sed 's@/config_ci$@/canonical_integration_ci@')"
test "$db" != "$CONFIG_TEST_DATABASE_URL"
psql -X -v ON_ERROR_STOP=1 "$CONFIG_TEST_DATABASE_URL" -c 'CREATE DATABASE canonical_integration_ci' >/dev/null
source_sql="$upstream/database/migrations/0001_shared_company_core.sql"
checksum="$(sha256sum "$source_sql" | cut -d' ' -f1)"
test "${#checksum}" -eq 64
psql -X -v ON_ERROR_STOP=1 "$db" -f "$source_sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -v source_hash="$checksum" "$db" <<'SQL' >/dev/null
INSERT INTO titan.schema_migrations(migration_id,checksum_sha256)
VALUES('0001_shared_company_core', :'source_hash');
SQL
for migration in packages/config-engine/sql/000[1-9]_*.sql; do
 test -f "$migration"
 psql -X -v ON_ERROR_STOP=1 "$db" -f "$migration" >/dev/null
done
psql -X -v ON_ERROR_STOP=1 "$db" -f packages/config-engine/sql/fixtures/real_canonical_seed.sql >/dev/null
for check in packages/config-engine/sql/canonical_verify_*.sql; do
 psql -X -v ON_ERROR_STOP=1 "$db" -f "$check" >/dev/null
done
bash packages/config-engine/scripts/check-service-logins.sh "$db"
CONFIG_TEST_DATABASE_URL="$db" node packages/config-engine/scripts/tls-postgres-e2e.mjs
npm ci --prefix apps/control-api --ignore-scripts --no-audit --no-fund
CONFIG_TEST_DATABASE_URL="$db" node packages/config-engine/scripts/e2e-config-read.mjs
CONFIG_TEST_DATABASE_URL="$db" node packages/config-engine/scripts/canonical-catalog-e2e.mjs
CONFIG_TEST_DATABASE_URL="$db" TITAN_CONFIG_CANONICAL_MIGRATION_SHA256="$checksum" node packages/config-engine/scripts/canonical-receipt-e2e.mjs
CONFIG_TEST_DATABASE_URL="$db" TITAN_CONFIG_CANONICAL_MIGRATION_SHA256="$checksum" node packages/config-engine/scripts/http-server-e2e.mjs
CONFIG_TEST_DATABASE_URL="$db" TITAN_CONFIG_CANONICAL_MIGRATION_SHA256="$checksum" node packages/config-engine/scripts/http-server-startup-failures.mjs
echo "pinned canonical PostgreSQL migration and signed JWT integration passed"
