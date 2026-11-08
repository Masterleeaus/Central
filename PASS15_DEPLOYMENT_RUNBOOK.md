# Titan Central Pass 15 — Deployment and integration handoff

## Verified status
This archive is a **full cumulative SOURCE release**, not an installed product, a replacement for the existing Desk/Field/Academy apps, or evidence of production SSO. No real Logto server, Titan Central database, or three-app login journey has been verified in this development environment. **Do not deploy by extracting over live application directories.**

### Ownership and service boundaries
| Component | Owner | Expected runtime |
|---|---|---|
| Logto | Unmodified upstream `/logto-master` | Independent authentication service, separate supported PostgreSQL DB |
| Titan Central | `titan-central/packages/control-plane` and `apps/control-api` | Independent service + separate PostgreSQL DB |
| Titan Desk | `/home/admin/apps/desk` | Existing AgentLabs; app-specific session adapter NOT mounted |
| Titan Field | `/home/admin/apps/ai-fsm` | Existing operational system; app-specific session adapter NOT mounted |
| Titan Academy | To be verified on server | LMS integration NOT mounted |

### Go/no-go requirements
1. Inventory live server: process manager, OS, Node/pnpm, free disk, ports, DirectAdmin proxy, certificates, backups. Never overwrite live local-only changes.
2. PostgreSQL 13.23 is not a supported foundation for contemporary Logto deployment. Use a supported isolated PostgreSQL instance, or execute separately approved backup-tested upgrade plan. Never run source migrations in the Desk/Field DBs.
3. Create independent `logto` and `titan_central` databases with separate restricted service roles. Audit/apply Central migrations 0001–0004 only to new Central DB; test RLS and indexing in actual PostgreSQL.
4. Deploy Logto and verify HTTPS discovery, JWKS, management scopes and signing-key rotation; configure three confidential OIDC clients with exact callback/logout URLs. Never store client secrets in ZIPs.
5. Reconcile existing app login/session stores and integrate `oidc-http-adapter`, `oidc-app-session`, `session-security` with **real** Desk, Field and Academy sessions. Do not remove original login until rollback tested. Every app must validate Central entitlements and local account links on protected requests.
6. Verify `app_account_id` / Field account membership mapping independently; never derive tenant from email or arbitrary query params. Validate two tenants and cross-tenant attempts (read, session, link, role changes).
7. Wire trusted provisioning mutations to revocation generation updates; prove multi-instance invalidation for membership removal, role demotion, entitlement change and account-link revocation.
8. Complete Logto RP-initiated logout and session revocation across all three apps. The current code supports only app-local logout; **global logout is NOT implemented**.
9. Run staged complete sign-in → Desk → Field → Academy → logout tests, restart and database-unavailable tests, rollback/recovery rehearsal, privacy/security review. Enable feature flags incrementally.
10. Only then remove temporary Desk direct-SELECT grants on five Field tables if the signed bridge has been separately validated and can operate without them.

### Safe read-only preflight
```
python3 titan-central/deploy/preflight.py \
 --config titan-central/deploy/staging.example.json \
 --root /path/to/extracted/archive \
 --live /home/admin/apps
```
The example **must FAIL** because all live deployment flags are false. Do not set any flag true without the corresponding executed evidence. There are no credentials or automatic migrations in the script. A successful exit from this checklist alone **does not prove** production security or function; it is an explicit operator evidence gate.

### Rollback
- Retain original app login routes and back up exact deployed application bundles and database schema before enabling SSO.
- Turn off Central/SSO feature flags before reversing proxy and session routing changes.
- Restore prior app versions if SSO callback/session state cannot be validated.
- Do not delete identity mappings or drop Logto/Central databases during a failed cutover unless a reviewed recovery plan explicitly requires it.

### Outstanding blockers
- No deployed Logto or working supported database verified.
- No live Central PostgreSQL persistence validated.
- No signed/actual OIDC application registrations confirmed.
- No real Desk, Field or Academy session adapters mounted and exercised.
- No global logout integration or real two-tenant security test.

**Decision:** release is staged-source complete, **NOT production-installable**.
