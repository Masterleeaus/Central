# Read-only canonical schema startup check

When config is enabled, Central checks PostgreSQL catalogs in a read-only
transaction using the dedicated configuration pool. Missing canonical
relations or single-column foreign keys fail startup before the HTTP
listener opens. The verifier does not create tables, seed data or change
migration history. On failure the dedicated config/grant pools and main
operational pool are closed.

This only checks structure, not migration checksums, live tenant isolation,
Logto verification or operational readiness. The production flag remains
off until those separately reviewed conditions pass.
