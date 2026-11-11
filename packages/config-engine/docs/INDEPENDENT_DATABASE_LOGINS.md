# Four independently authenticated PostgreSQL roles — Pass 17

Four LOGIN NOINHERIT PostgreSQL roles are mapped to distinct config-reader,
grant-reader, grant-writer and company-authority NOLOGIN roles. The new draft
migration does not assign passwords. Only disposable CI assigns throwaway
test credentials, then separately authenticates each role over TCP and
asserts it cannot SET ROLE into another service's permissions.

The signed JWT/real PostgreSQL end-to-end pipeline now uses two separate
database login pools, one per readonly service. The config factory rejects
a shared privileged pool.

This does not complete TLS enforcement, migration orchestration, production
role provisioning or secret rotation; review these before live enablement.
