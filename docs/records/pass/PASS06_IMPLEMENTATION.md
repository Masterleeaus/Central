# Pass 06 — Trusted Logto Management API boundary (candidate, not deployed)

## Scope

This pass introduces a **server-only, fail-closed** verification adapter and provisioning wrapper in the Titan-owned control-plane package. No upstream Logto files were edited. No mutation endpoints were exposed. No live database operations were performed.

### Implemented

- `packages/control-plane/src/logto-management.ts`: fixed HTTPS Logto Management API origin and short-lived **machine-to-machine** credential supplier, strict identity/org verification, exhaustive bounded organisation-member lookup (`GET /api/organizations/:id/users?page=N&page_size=100`), fail-closed error handling, 5-second network timeout, no redirect following. Routes confirmed against supplied Logto source `packages/core/src/routes/organization/user/index.ts`.
- `packages/control-plane/src/trusted-provisioning.ts`: mandatory trusted actor matching, independent server-side policy callback, Logto user/organisation/membership verification, and separate application-account-control proof callback **before** invoking the Pass 05 transactional `CentralProvisioner`.
- Automated checks cover unauthorised requests, revoked membership, unmatched users, page bounds, missing app-account proof and API errors.

### Not implemented yet / production blockers

1. Real Logto server + service-to-service client-credentials token acquisition and scope restrictions. **The `accessToken` callback is not supplied in this source**; it must only be wired to a server-held, least-privilege M2M credential.
2. Actual administrator-authority policy, including current role/membership and explicit delegation scope. The injected `authorize` function **must independently verify actor authority**; never implement it as `async () => true` in production.
3. Real `resolve` canonical mappings verified against the persistent database, and actual Field/Desk/Academy account-control proofs. A local account ID, email or company name is **not** evidence.
4. Runtime/Postgres integration tests and SSO client registrations in a live Logto installation. The previous 0001/0002 SQL files remain draft/unapplied.
5. OIDC login redirects/callback handlers in Desk, Field and Academy. There is still **no functioning cross-app SSO**.
6. Multi-page membership validation is currently bounded to at most 2,500 members (default) and 10,000 at a hard maximum; large orgs require an API keyed lookup or approved pagination strategy. This fails closed on overflow.
7. Validate Logto Management API permissions, tenancy, token lifetimes and enterprise feature/licensing needs before production.

## Deployment boundaries

Run this package in a **trusted backend only**, not in browser code or untrusted plug-in contexts. Never expose provisioning to a public HTTP endpoint without its own verified authentication and authorisation. Keep the Logto engine patch-free, and do not deploy or migrate the existing `ai_fsm` and `titan_desk` databases from this archive.

## Next pass

Create a real M2M token client and organisation-authority policy, verify against a containerised/sandbox Logto instance, then wire a trusted administrative interface and OIDC applications, with rollback and source preservation.
