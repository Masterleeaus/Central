#!/usr/bin/env bash
set -euo pipefail
test -n "$CONFIG_TEST_DATABASE_URL"
directory="/tmp/titan-config-ca"
mkdir -p "$directory"
container="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 ~ /^postgres:16/ {print $1;exit}')"
test -n "$container"
docker exec -u postgres "$container" sh -eu -c '
 cd "$PGDATA"
 openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout titan-ci-server.key -out titan-ci-server.crt >/dev/null 2>&1
 chmod 600 titan-ci-server.key
 chmod 644 titan-ci-server.crt
 psql -U postgres -d config_ci -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET ssl = on" >/dev/null
 psql -U postgres -d config_ci -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET ssl_cert_file = '\''titan-ci-server.crt'\''" >/dev/null
 psql -U postgres -d config_ci -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET ssl_key_file = '\''titan-ci-server.key'\''" >/dev/null
 psql -U postgres -d config_ci -v ON_ERROR_STOP=1 -c "SELECT pg_reload_conf()" >/dev/null
'
pgpath="$(docker exec -u postgres "$container" sh -c 'printf "%s" "$PGDATA"')"
docker cp "$container:$pgpath/titan-ci-server.crt" "$directory/ca.pem"
test "$(psql -X -v ON_ERROR_STOP=1 "$CONFIG_TEST_DATABASE_URL" -Atc 'SHOW ssl')" = on
printf 'CONFIG_TLS_CA_FILE=%s\n' "$directory/ca.pem" >> "$GITHUB_ENV"
