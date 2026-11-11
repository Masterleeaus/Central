# Config RLS security model — draft

Policies on scopes and revisions filter company and cohort overrides in
PostgreSQL when the connection switches to a restricted role. Audit inserts
are similarly scoped. The CI tests use SET LOCAL ROLE and transaction-local
custom settings.

A custom PostgreSQL setting is NOT proof of identity: a service with unrestricted
SQL access can impersonate a company by changing it. Production must use
centrally authenticated M2M credentials, verified company membership and a
restricted query interface. The unified #43 migration must add canonical
company foreign keys; none are available in this isolated draft schema.
