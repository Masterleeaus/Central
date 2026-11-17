# Titan Central architecture decisions (Pass 01)

- ADR-001: isolate upstream Logto; Titan extensions live separately.
- ADR-002: **one** canonical identity provider; four product-local sessions; independently enforced application permissions.
- ADR-003: target one PostgreSQL database for Titan Central, Sorted, Supercharged, Scheduled, and Skilled/LMS (source repository: `Masterleeaus/Skilled`). Shared identity/company tables live in the `titan` schema; app-owned domain tables use canonical `company_id` foreign keys to `titan.companies`. Existing separate application databases remain in place until an independently verified migration cutover; this source foundation does not authorize that cutover.
- ADR-004: company membership must be checked at each app API boundary and revocation propagated, not inferred from email/company text. Each tenant-owned row uses the canonical `company_id` UUID.
- ADR-005: no shared application secrets; per-service OIDC registrations and signed server-to-server tokens when appropriate.
- ADR-006: the migration target keeps tenant business data in the shared Titan PostgreSQL database, not in Logto. Logto remains the identity provider.
- ADR-007: manage deployments as immutable tagged source + reviewable Titan delta, never overwrite live apps from ZIP.

- ADR-008: Central owns the canonical shared database schema and ordered migration registry. App repositories contribute reviewed app-domain migrations to that single chain; they do not independently apply schema pushes to production.

## ADR-009: Five-product integrated deployment invariant (2026-11-15)

- **One physical PostgreSQL database** (same database name/cluster target), not five databases on one PostgreSQL server. Central, Sorted, Scheduled, Skilled and Supercharged connect through separate least-privilege credentials; product-owned schemas may be distinct within that database.
- **Central is the identity authority**: Logto-backed OIDC for every product, verified canonical company UUID, per-app permissions and service audiences. Legacy local login is not a production sign-in alternative in integrated mode.
- **One ordered migration authority**: Central coordinates immutable migration checksums, advisory locking, tenancy boundaries and database schema versioning. Product ORM schemas are clients of the shared contract, not independent production migration owners.
- **Scheduled is one Laravel app**: PlusAgency website and Cleanto booking functionality run in-process under one routing/auth/transaction boundary. No Cleanto sidecar, separate service, MySQL/MariaDB runtime or second booking authority. Scheduled owns booking and calendar state; Sorted owns jobs; Skilled owns learning; Supercharged owns communications and agent workflows.
- **Do not mark cutover complete yet.** Scheduled still has MySQL defaults and Central's existing migration/registry implementations have not passed five-app integration acceptance. See Central #140/#141/#142 and Scheduled #46/#49.

This ADR states the target contract; it does not assert production readiness or that database migrations have been applied.
