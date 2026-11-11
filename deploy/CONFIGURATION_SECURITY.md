# Configuration runtime deployment policy (currently disabled)

The Central configuration endpoint is opt-in and requires the approved
canonical migration chain (#43), a dedicated verified-TLS Postgres connection
for titan_config_api_login and a separate one for
titan_config_grants_login, a dedicated Logto audience and rollout secret.

The general TITAN_CENTRAL_DATABASE_URL must never be reused for config
or grant queries. The database connection strings must be placed only in
the root-owned environment file, never source control or log output.

The migration approval flag is a manual gate: a passing disposable CI test
does not establish authoritative migrations or security approval. No live
deployment is performed in this change.

PostgreSQL transport must use verified TLS, not merely a URI that says
verify-full. The isolated canonical CI test now checks active pg_stat_ssl
and rejects a missing trust root. Production still requires CA provisioning.
