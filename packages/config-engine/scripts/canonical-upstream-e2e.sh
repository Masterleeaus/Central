#!/usr/bin/env bash
set -euo pipefail
upstream="$1"
test "$(git -C "$upstream" rev-parse HEAD)" = "$CANONICAL_COMPANY_PIN"
test -f "$upstream/database/migrations/0001_shared_company_core.sql"
db="$(printf '%s' "$CONFIG_TEST_DATABASE_URL" | sed 's@/config_ci$@/canonical_integration_ci@')"
test "$db" != "$CONFIG_TEST_DATABASE_URL"
psql -X -v ON_ERROR_STOP=1 "$CONFIG_TEST_DATABASE_URL" -c 'CREATE DATABASE canonical_integration_ci' >/dev/null
psql -X -v ON_ERROR_STOP=1 "$db" -f "$upstream/database/migrations/0001_shared_company_core.sql" >/dev/null
for migration in packages/config-engine/sql/000[1-8]_*.sql; do
 test -f "$migration"
 psql -X -v ON_ERROR_STOP=1 "$db" -f "$migration" >/dev/null
done
psql -X -v ON_ERROR_STOP=1 "$db" -f packages/config-engine/sql/fixtures/real_canonical_seed.sql >/dev/null
for check in packages/config-engine/sql/canonical_verify_*.sql; do
 psql -X -v ON_ERROR_STOP=1 "$db" -f "$check" >/dev/null
done
bash packages/config-engine/scripts/check-service-logins.sh "$db"
npm ci --prefix apps/control-api --ignore-scripts --no-audit --no-fund
CONFIG_TEST_DATABASE_URL="$db" node packages/config-engine/scripts/e2e-config-read.mjs
CONFIG_TEST_DATABASE_URL="$db" node packages/config-engine/scripts/canonical-catalog-e2e.mjs
echo "pinned canonical PostgreSQL migration and signed JWT integration passed"
