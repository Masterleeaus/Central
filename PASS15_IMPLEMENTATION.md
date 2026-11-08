# Titan Central — Pass 15 status

Pass 15 added the read-only deployment gate, a non-secret staging configuration example and a deployment/rollback runbook. Those pass records describe the product names and paths used at the time.

The current product names and Central IDs are now:

- Sorted — `sorted`
- Supercharged — `supercharged`
- LMS — `lms`

The current source layout and integration boundaries are documented in the root README, `TITAN_ARCHITECTURE_DECISIONS.md`, and `PASS15_DEPLOYMENT_RUNBOOK.md`.

The deployment gate does not connect to PostgreSQL or any product service. Live installation, OIDC, product adapters, tenant isolation, logout and rollback remain unverified. Production readiness remains **No**.
