# Titan Central architecture decisions (Pass 01)

- ADR-001: isolate upstream Logto; Titan extensions live separately.
- ADR-002: **one** canonical identity provider; three application-local sessions; independently enforced application permissions.
- ADR-003: use one PostgreSQL database for Titan Central, Sorted, Supercharged, and LMS (source repository: `Masterleeaus/Skilled`). Shared identity/company tables live in the `titan` schema; app-owned domain tables use canonical `company_id` foreign keys to `titan.companies`. Do not provision separate per-app business databases.
- ADR-004: company membership must be checked at each app API boundary and revocation propagated, not inferred from email/company text. Each tenant-owned row uses the canonical `company_id` UUID.
- ADR-005: no shared application secrets; per-service OIDC registrations and signed server-to-server tokens when appropriate.
- ADR-006: tenant business data stays in the shared Titan PostgreSQL database, not in Logto. Logto remains the identity provider.
- ADR-007: manage deployments as immutable tagged source + reviewable Titan delta, never overwrite live apps from ZIP.

- ADR-008: Central owns the canonical shared database schema and ordered migration registry. App repositories contribute reviewed app-domain migrations to that single chain; they do not independently apply schema pushes to production.
