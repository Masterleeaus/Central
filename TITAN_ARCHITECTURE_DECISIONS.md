# Titan Central architecture decisions (Pass 01)

- ADR-001: isolate upstream Logto; Titan extensions live separately.
- ADR-002: **one** canonical identity provider; three application-local sessions; independently enforced application permissions.
- ADR-003: separate `titan_central` database from `ai_fsm`, `titan_desk`, `titan_academy`; no cross-database foreign keys.
- ADR-004: org membership must be checked at API boundary and revocation propagated, not inferred from email/company text.
- ADR-005: no shared application secrets; per-service OIDC registrations and signed server-to-server tokens when appropriate.
- ADR-006: tenant data stays in Field/Desk/Academy, not replicated to Logto.
- ADR-007: manage deployments as immutable tagged source + reviewable Titan delta, never overwrite live apps from ZIP.
