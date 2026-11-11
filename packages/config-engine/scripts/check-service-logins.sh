#!/usr/bin/env bash
set -euo pipefail
admin="$1"
psql -X -v ON_ERROR_STOP=1 "$admin" -f packages/config-engine/sql/fixtures/login_credentials_ci.sql >/dev/null
build_url() {
 CI_ROLE="$1" CI_SECRET="$2" python3 - "$admin" <<'PY'
import os,sys
from urllib.parse import urlsplit,urlunsplit,quote
u=urlsplit(sys.argv[1])
host=u.hostname or 'localhost'
host+=(':'+str(u.port)) if u.port else ''
netloc=quote(os.environ['CI_ROLE'],safe='')+':'+quote(os.environ['CI_SECRET'],safe='')+'@'+host
print(urlunsplit((u.scheme,netloc,u.path,u.query,u.fragment)))
PY
}
api="$(build_url titan_config_api_login ci-config-api-only)"
grants="$(build_url titan_config_grants_login ci-config-grants-only)"
writer="$(build_url titan_config_grant_admin_login ci-grant-admin-only)"
authority="$(build_url titan_config_authority_login ci-company-authority-only)"
allow(){ psql -X -v ON_ERROR_STOP=1 "$1" -Atc "$2" >/dev/null; }
deny(){ if psql -X -v ON_ERROR_STOP=1 "$1" -Atc "$2" >/dev/null 2>&1;then echo "unauthorised SQL succeeded: $2" >&2;exit 1;fi; }
allow "$api" 'BEGIN; SET LOCAL ROLE titan_config_reader; SELECT count(*) FROM titan_config.definitions; COMMIT;'
allow "$grants" 'BEGIN; SET LOCAL ROLE titan_config_grant_reader; SELECT count(*) FROM titan_config.service_company_grants; COMMIT;'
allow "$writer" 'BEGIN; SET LOCAL ROLE titan_config_grant_writer; SELECT count(*) FROM titan_config.service_company_grants; COMMIT;'
allow "$authority" 'BEGIN; SET LOCAL ROLE titan_config_company_authority_reader; SELECT count(*) FROM titan.company_memberships; COMMIT;'
deny "$api" 'SET ROLE titan_config_grant_reader'
deny "$api" 'SET ROLE titan_config_grant_writer'
deny "$api" 'SELECT * FROM titan_config.revisions LIMIT 1'
deny "$grants" 'SET ROLE titan_config_reader'
deny "$grants" 'SET ROLE titan_config_grant_writer'
deny "$grants" 'DELETE FROM titan_config.service_company_grants'
deny "$writer" 'SET ROLE titan_config_reader'
deny "$writer" 'SET ROLE titan_config_company_authority_reader'
deny "$authority" 'SET ROLE titan_config_reader'
deny "$authority" 'SET ROLE titan_config_grant_writer'
echo "Four independently authenticated PostgreSQL login boundaries verified"
