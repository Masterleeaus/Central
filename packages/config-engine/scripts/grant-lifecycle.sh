#!/usr/bin/env bash
set -euo pipefail
db="$1"
psql -X -v ON_ERROR_STOP=1 "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE titan_config_grant_writer;
SELECT set_config('titan_config.grant_actor','operator_a',true);
INSERT INTO titan_config.service_company_grants
(client_id,product,environment,company_id,state,cohorts)
VALUES('ci_grant_lifecycle','central','stage','550e8400-e29b-41d4-a716-446655440000','active',ARRAY['early']);
UPDATE titan_config.service_company_grants SET state='revoked',revision=revision+1
 WHERE client_id='ci_grant_lifecycle' AND revision=1;
COMMIT;
BEGIN;
SET LOCAL ROLE titan_config_grant_reader;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM titan_config.service_company_grants WHERE client_id='ci_grant_lifecycle' AND state='active') THEN
 RAISE EXCEPTION 'revoked grant remained active';END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.service_grant_audit a JOIN titan_config.service_company_grants g ON g.id=a.grant_id
 WHERE g.client_id='ci_grant_lifecycle')<>2 THEN RAISE EXCEPTION 'audit missing grant create/revoke';END IF;
END $$;
DELETE FROM titan_config.service_grant_audit WHERE grant_id IN (SELECT id FROM titan_config.service_company_grants WHERE client_id='ci_grant_lifecycle');
DELETE FROM titan_config.service_company_grants WHERE client_id='ci_grant_lifecycle';
SQL
echo "restricted PostgreSQL grant lifecycle passed"
