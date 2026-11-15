# Titan Central: operator and live-system readiness register

Status: audit register, docs only. Written 2026-11-15 by integration work package B1.
Scope: every task in the Scheduled, Central, Supercharged, Skilled (LMS) and Sorted integration that an agent cannot complete from the repositories and that needs an operator, an owner decision or a live system.

Basis: the Central docs under `docs/`, `deploy/`, `database/`, `packages/*/docs`, `apps/control-api/CENTRAL_LAUNCHER.md`, the CI workflows under `.github/workflows/`, and the product docs in the Scheduled, Skilled, Sorted and Supercharged repositories (read only). Nothing was run against a database, Logto, DNS, a host, a payment provider or any other external service.

Gate flags that must stay `false` until evidence exists (`deploy/staging.example.json`, `deploy/preflight.py`): `central_db_separate`, `logto_db_separate`, `supported_postgres`, `app_adapter_implemented` (desk, field, academy), `real_logto_verified`, `migration_verified`, `two_tenant_test_passed`, `global_logout_test_passed`, `rollback_test_passed`. Scheduled has no entry in these gates yet.

Owner roles used below:
- **Platform owner**: decides product identity, security posture and cross-product policy.
- **Logto admin**: controls the Logto tenant and its applications.
- **DBA**: controls PostgreSQL servers, roles, backups and migrations.
- **Host operator**: controls the server, the reverse proxy, TLS, DNS and the secret file.
- **Product owner**: Sorted, Supercharged, Skilled (LMS) or Scheduled.
- **Legal/privacy reviewer**: decides items marked TO DECIDE (legal) in the docs.

---

## 1. Identity: Logto tenant and applications

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-01 | Create the confidential launcher application in Logto, with the redirect URI `<centralOrigin>/auth/titan/launcher/callback`, and record its ID and audience. | Logto admin | Central origin fixed; launcher origin decided (see R-44) | The launcher stays signed out. The session exchange cannot be enabled. | `docs/LAUNCHER_OIDC.md` steps 1 to 5 |
| R-02 | Create the three confidential OIDC applications for Sorted, Supercharged and LMS, and their callback and logout URIs. | Logto admin | Pinned Logto deployed to a staging origin (R-08); supported PostgreSQL (R-09) | No product can sign in through Central. Access checks cannot be exercised end to end. | `docs/UPSTREAM.md` "Outside this repository"; `docs/APP-BUILDER-INTEGRATION.md` section 8 |
| R-03 | Create a confidential application for Scheduled once the product id is final (R-27), with a distinct audience `urn:titan-central:product:scheduled`. | Logto admin, Platform owner | R-27 decided; Scheduled origin known | Scheduled cannot sign in or be verified as a product. | `scheduled/docs/CENTRAL-REGISTRY-PROPOSAL.md` |
| R-04 | Create the machine-to-machine application and set `TITAN_LOGTO_M2M_CLIENT_ID`, `TITAN_LOGTO_M2M_CLIENT_SECRET`, `TITAN_LOGTO_MANAGEMENT_ORIGIN`, `TITAN_LOGTO_MANAGEMENT_RESOURCE` and `TITAN_LOGTO_MANAGEMENT_SCOPE` in `/etc/titan-central/central.env` on the server only. | Logto admin, Host operator | Logto tenant live | The operator plane stays off. `deploy/preflight.py --env-file` exits 1. | `deploy/OPERATIONS.md` "Operator plane configuration" |
| R-05 | Set `TITAN_OPERATOR_ORGANISATION_ID` and `TITAN_OPERATOR_ROLE_IDS` to the owner-provided Logto IDs. | Platform owner, Host operator | R-04 | Operator routes stay disabled. Provisioning cannot be performed. | `deploy/OPERATIONS.md` step 1 |
| R-06 | Set `TITAN_TENANT_ADMIN_ROLE_IDS` from the Logto owner's reviewed IDs. | Logto admin, Platform owner | R-04 | `POST /v1/admin/tenant/provision` answers 503 `provisioning_disabled`. Tenant onboarding is blocked. | `deploy/OPERATIONS.md`, issue #34 note |
| R-07 | Run discovery, JWKS and management-scope checks, then sign-in, logout and rollback tests against a staging Logto. Record the result before setting `real_logto_verified`. | Logto admin, Platform owner | R-02, R-04 | Central accepts tokens and sessions that have never been exercised against the real issuer. A broken logout or rollback is found in production. | `docs/UPSTREAM.md`; `deploy/staging.example.json` |
| R-08 | Verify the upstream pin. The tag `v1.45.0` resolves to commit `94c088f9e4f87ba93df1f72ed20edf16ce364f61` (recorded 2026-11-11). Run the tree comparison; the vendored tree is absent, so it has not been run. Decide whether a vendored tree is kept or the comparison is recorded against a scratch checkout. | Platform owner | Access to the upstream repository | Central runs against an unverified Logto source. | `docs/UPSTREAM.md` "Tree comparison" |
| R-09 | Install a supported PostgreSQL for Logto and confirm its minimum version against the pinned release. Do not run Logto or Central on the live PostgreSQL 13.23 and do not migrate it in place. | DBA | R-08 | Logto runs on an unsupported database, or the team migrates a production database in place. | `docs/UPSTREAM.md` "PostgreSQL requirement"; `docs/records/pass/PASS15_DEPLOYMENT_RUNBOOK.md` |

## 2. Databases, roles and migrations

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-10 | Create separate databases for Logto and `titan_central`, with restricted service roles and no cross-database foreign keys. Set `central_db_separate` and `logto_db_separate` to `true` only after this is verified. | DBA | R-09 | Shared database coupling. Compromise of one service reaches the other. | `docs/UPSTREAM.md`; ADR-003; `deploy/staging.example.json` |
| R-11 | Provision each database login separately from a managed secret source: `titan_central_app`, the OIDC namespace role, the config reader and service-grant reader, product selection roles and the trusted reader and writer roles. Confirm none is SUPERUSER, BYPASSRLS, or inherits another's privileges. | DBA | R-10 | Row-level security can be bypassed. A product role can read another product's selections. | `packages/config-engine/docs/PRODUCTION_DB_LOGIN_CHECKLIST.md`; `deploy/proxy/README.md` "Product OIDC company choice deployment gate" step 4 |
| R-12 | Apply the legacy migration chain `migrations/0001` to `0028` to a restored staging copy, then to production, with a verified backup taken first. | DBA, Platform owner | R-10, R-15 | Schema drift between code and database. Feature flags, outbox, link and retention tables are absent. | `migrations/`; `docs/RETENTION.md` |
| R-13 | Apply the canonical chain `database/migrations/0001` to `0013` to separate disposable and staging databases. The chain is independent of the legacy chain; do not run both on the same database. | DBA | R-10 | Canonical company and Scheduled registration rows are absent. | `database/README.md` "Critical limitations"; `database/migrations/` |
| R-14 | Decide which chain carries the Scheduled registration. `database/migrations/0013_scheduled_product_registration.sql` exists in the canonical chain only. The legacy chain has no `scheduled` value. Confirm the choice before any apply. | Platform owner, DBA | None | Scheduled cannot hold entitlements or account links, and the access check rejects it. | `database/migrations/0013_scheduled_product_registration.sql`; grep of `apps`, `packages`, `tools`, `deploy` finds no `scheduled` outside tests |
| R-15 | Resolve the staged drafts in `integration/staged-central-browser-migrations/` (0010 to 0015). They are superseded by the integrated 0019 to 0024 and the launcher reconciliation maps 0013 to 0022. The staged file names collide with legacy `0013_feature_flags.sql`. Archive or delete them after owner sign-off. Do not apply them. | Platform owner | None | Applying a superseded draft under a number that already exists, which breaks checksum locks. | `docs/integration/central-main-launcher-reconciliation.md` migration table |
| R-16 | Canonical staging backfill: the CLI needs an operator-inserted approval row, a separate issuer role and an off-database Ed25519 receipt signed by a key held outside the repository. Keep the signing key with a named human owner. | Platform owner, DBA | R-13 | The backfill has no independent approval evidence. HMAC or database-name allowlists do not prove a human approved it. | `database/README.md` passes 18, 20 and 21 |
| R-17 | Run the retention purge (`tools/retention_purge.py`, migration 0028) only with an owner-chosen `--export-dir` on a protected path, after a dry run. It has never been run. | Platform owner, DBA | R-12; R-19 decided | Unbounded audit and activity growth. Or a purge that deletes rows before the export exists. | `docs/RETENTION.md`; `database/retention/rollback_0028.sql` |
| R-18 | Confirm PostgreSQL TLS for every live connection (`verify-full` with the CA). The CI-only self-signed certificate does not prove production. | DBA, Host operator | R-10 | Credentials and data cross the network unverified. | `packages/config-engine/docs/POSTGRES_VERIFIED_TLS_CI.md`; `deploy/CONFIGURATION_SECURITY.md` |
| R-19 | Decide the retention and erasure rules marked TO DECIDE: whether `actor_subject` and `subject_id` are personal data; pseudonymisation versus deletion; the start point of the 1-year audit period; export store and its life; backup retention; journal period; which roles may read activity. | Legal/privacy reviewer, Platform owner | None | Unlawful retention. Erasure requests cannot be honoured. Activity readers see more than their role allows. | `docs/RETENTION.md` sections 1, 3, 4, 5, 6 |
| R-20 | Define backup and restore for `titan_central` and the Logto database, with a scheduled restore drill. | DBA, Host operator | R-10 | No tested recovery path. Rollback relies on a backup that has never been restored. | `deploy/OPERATIONS.md` "Roll back"; `docs/RETENTION.md` section 4 |
| R-21 | Set connection limits and a credential rotation schedule for each database login. | DBA | R-11 | Connection exhaustion. Long-lived credentials. | `packages/config-engine/docs/PRODUCTION_DB_LOGIN_CHECKLIST.md` |

## 3. Account linking, link keys and product signing

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-22 | Provision link-assertion public keys in the operator configuration (`TITAN_LINK_KEYS_FILE` or `TITAN_LINK_KEYS_JSON`), one entry per product key id. Public keys only. | Platform owner, Host operator | Product owners supply public JWKs | No link can be verified. Linking fails closed. | `docs/LINKING.md` "Key configuration"; `deploy/env.example` |
| R-23 | Register the Skilled public key under kid `skilled-key-2026` (or the kid Skilled uses in production) in the `lms` key set. | Product owner (Skilled), Host operator | R-22 | LMS links fail with `bad_signature`. | `docs/LINKING.md` "Differences to resolve" item 3 |
| R-24 | Scheduled exports its public JWK with `scheduled/scripts/export-public-jwk.js`, and Central has a registration place for it. Decide where per-product public keys live (registry, operator config or key set). | Product owner (Scheduled), Platform owner | R-27 | Scheduled cannot create links. | `scheduled/docs/CENTRAL-REGISTRY-PROPOSAL.md` "Link-assertion key" |
| R-25 | Sorted, Supercharged and LMS add Ed25519 link signing: hold the private key, issue opaque immutable local IDs, and never sign display names or emails. Central has no product-side signer. | Product owners (Sorted, Supercharged, Skilled) | R-22 | Account links cannot be created in production. Issues #32 and #37 stay open. | `docs/LINKING.md` "Scope"; `apps/control-api/CENTRAL_LAUNCHER.md` section on product linking |
| R-26 | Decide whether Central should require more evidence for the LA-09 to LA-13 and LA-22 to LA-26 cases. Central accepts these and relies on the product refusing to sign. | Platform owner, Security reviewer | None | A well-formed assertion can link an account the product would refuse. | `docs/LINKING.md` "Skilled fixture alignment" |
| R-27 | Confirm the product id `scheduled` (placeholder), its audience, the tenant key `org`, and the origin variable name `TITAN_SCHEDULED_ORIGIN`. Changing the id later changes `iss` and the audience. | Platform owner, Product owner (Scheduled) | None | Rename after launch breaks links and the audience check. | `scheduled/docs/CENTRAL-REGISTRY-PROPOSAL.md` "Open questions" |
| R-28 | Confirm the tenant keys: `account_id` (Sorted), `company_account_id` (Supercharged), `companyRef` (LMS), `org` (Scheduled). Central marks all of them as unverified assumptions. | Product owners | None | A cross-tenant check compares the wrong field and passes or fails incorrectly. | `docs/PRODUCT_REGISTRY.md` "Canonical products" |
| R-29 | Resolve the review queue. Ambiguous links are recorded and fail closed, but no review UI exists. Operators resolve only through `link_review_resolve`. | Platform owner | R-22 | Ambiguous links remain unresolved and accounts stay unlinked. | `docs/LINKING.md` "Scope and what is not implemented" |

## 4. Outbox events, feature flags and product registry

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-30 | Generate one or two route secrets per outbox route, each at least 32 characters. Place them in the environment or secret store on both sides. Never in the JSON route list or in events. | Host operator, Product owners | Consumer endpoints live | Events are not signed and verified, or the secrets leak through configuration. | `docs/EVENTS.md` "Key rotation" and "Secrets" |
| R-31 | Approve each business event, add it to the production event registry, and decide each consumer. The production registry is empty. | Platform owner, Product owners | R-30 | No cross-product handoff can be sent. The worker publishes nothing. | `docs/EVENTS.md` first paragraph; `packages/control-plane/src/outbox.ts` |
| R-32 | Run the outbox worker as a systemd process with its own environment file (`deploy/outbox-worker.env.example`, `deploy/outbox-worker.service`). | Host operator | R-30, R-31 | Events remain pending and retry forever. | `deploy/OPERATIONS.md`; `deploy/outbox-worker.service` |
| R-33 | Decide the dead-letter retry limit and alerting for outbox and billing events. | Platform owner | R-32 | Dead events sit unseen. | `docs/EVENTS.md` (replay is operator-only); `docs/SUBSCRIPTIONS.md` item 11 |
| R-34 | Declare real feature flags with an owner for each, and set their values per environment. None is declared. | Platform owner, Product owners | R-13 | No flag can be read. Products fall back to compiled defaults. | `docs/CONFIG.md` section 2; `docs/APP-BUILDER-INTEGRATION.md` section 7 |
| R-35 | Set `TITAN_FIELD_ORIGIN` (sorted), `TITAN_DESK_ORIGIN` (supercharged), `TITAN_ACADEMY_ORIGIN` (lms) and `TITAN_SCHEDULED_ORIGIN` together, as public HTTPS names, and list each in `TITAN_PRODUCT_TRUSTED_ORIGINS`. | Host operator, Product owners | DNS (R-38) | Startup fails when any origin is set without the others. GitHub hosts and IP literals are refused. | `docs/PRODUCT_REGISTRY.md` "Operator configuration" |
| R-36 | Confirm the registry contract drafts (`0.1.0-draft`) and the declared capabilities with each product owner. | Product owners | None | Products declare the wrong capabilities. The contract check flags them at runtime. | `docs/PRODUCT_REGISTRY.md` |
| R-37 | Decide whether legacy ids (`field`, `desk`, `academy`) stay in stored records or are migrated. The current decision keeps them to avoid silent relabelling. Record the decision. | Platform owner | None | Access decisions change meaning if the ids are renamed. | `docs/PRODUCT_REGISTRY.md` "Not done, and why" |

## 5. DNS, TLS, reverse proxy and hosts

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-38 | Create public DNS records and TLS certificates for `central`, `auth`, `desk`, `field`, `academy` and the Scheduled hostname, and for each product vhost. | Host operator | Hostnames decided (R-27) | OIDC callbacks fail. Origins cannot be validated. | `deploy/staging.example.json` `provisioned_hostnames`; `deploy/OPERATIONS.md` |
| R-39 | Choose the public proxy. Run `ss -ltnp` and `systemctl is-active httpd nginx`. If Apache is the only front, mod_qos must be loaded globally, and the 429 burst test must pass before use. Otherwise use nginx. | Host operator | None | Rate limits are not enforced on sign-in or access endpoints. | `deploy/proxy/README.md` section 1 |
| R-40 | Apply the Central proxy templates through DirectAdmin custom httpd configuration. Replace `__CENTRAL_PORT__`, and the operator-chosen concurrency integers for Apache. Run `nginx -t` or `apachectl -t` before reload. | Host operator | R-39 | Limits and private-path denials are not in effect. | `deploy/proxy/README.md` sections 2 and 4 |
| R-41 | Run `deploy/proxy/live_check.py` from outside the host and the burst tests on `/v1/access/check`, the callback and company selection. Expect 404 for `/v1/admin/` and `/metrics`, and 429 under burst. Do not paste response bodies into tickets. | Host operator | R-40 | `/v1/admin/`, `/metrics` and `/internal/` can be reached from the internet. | `deploy/proxy/README.md` sections 4 and 4a |
| R-42 | Confirm the proxy rewrites `X-Forwarded-For` from the socket and that the app listens on loopback only. The app's own per-IP limit is effectively global behind the proxy. | Host operator | R-40 | A client can spoof its address, or all traffic shares one bucket. | `deploy/proxy/README.md` section 3 |
| R-43 | Apply the product-host selection templates (`nginx/product-selection.conf.template` and the Apache equivalent) to each product vhost. Run the product-host saturation and account-isolation tests. | Host operator, Product owners | Product hosts live | Company selection POSTs are uncapped. One product's selection role can reach another's data. | `deploy/proxy/README.md` "Product-host company-choice endpoints"; `deploy/proxy/README.md` "Product OIDC company choice deployment gate" |
| R-44 | Before enabling `/v1/launcher/session`, add `/v1/launcher/` to the proxy deny list (issue #74), choose loopback-only or a shared secret, and decide the launcher audience (`TITAN_LAUNCHER_AUDIENCE`). The route returns a bearer token. | Platform owner, Host operator | R-01 | Anyone reaching the route can obtain a bearer token. | `docs/LAUNCHER_OIDC.md` "Open decisions" |
| R-45 | Record the launcher's public origin and add it to the Logto application and the launcher config together. | Platform owner, Logto admin | R-01 | Post-logout redirect fails. | `docs/LAUNCHER_OIDC.md` step 3 (Open) |
| R-46 | Confirm that proxy access logs (which hold IP addresses) and journald have a retention decision and a shipping destination. | Legal/privacy reviewer, Host operator | R-19 | Unbounded or unlawful IP retention. | `docs/RETENTION.md` sections 3 and 4 |
| R-47 | Add the repository variables `CENTRAL_PUBLIC_HOST`, `CENTRAL_NODE_PORT` and `CENTRAL_PUBLIC_IP` so the daily host-checks workflow runs its live check. Without them the job reports `skipped`. | Platform owner | R-38 | No daily external check of the public surface. | `.github/workflows/host-checks.yml` |

## 6. Host install and operation (Central)

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-48 | Create a dedicated service account, install the Node.js executable path, render `deploy/central.service`, and install it as `/etc/systemd/system/titan-central.service`. | Host operator | R-10 | The service runs as root, or from a shared product directory. | `deploy/OPERATIONS.md` "Prepare a release" and "Install and operate" |
| R-49 | Create `/etc/titan-central/central.env` (root:root, 0600) from `deploy/env.example`. Replace every `REPLACE_ME` on the server only. | Host operator | R-04, R-11 | Secrets leak into the repository or a ZIP. Or the service fails to start. | `deploy/OPERATIONS.md` "Store secrets" |
| R-50 | Run `python3 -I deploy/preflight.py --env-file /etc/titan-central/central.env` on the server. It prints names only. | Host operator | R-49 | The operator plane is misconfigured. | `deploy/OPERATIONS.md` step 4 |
| R-51 | Run the health check on loopback and keep the release directories immutable, with the previous release retained. | Host operator | R-48 | No rollback target. | `deploy/OPERATIONS.md` |
| R-52 | Set `TITAN_CENTRAL_BROWSER_CLIENT_ID` and `TITAN_CENTRAL_BROWSER_CLIENT_SECRET` and `TITAN_OIDC_STATE_KEY` on the server only. The state key must be a random key distinct from login and OIDC secrets. | Host operator, Logto admin | R-02 | Browser OIDC cannot start. Or the state key is reused across services. | `apps/control-api/CENTRAL_LAUNCHER.md` section on browser configuration; `database/README.md` |

## 7. Payments and subscriptions

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-53 | Choose a billing provider and create its account. Store the webhook signing secret in the owner's secret store, outside the repository. The Central webhook route does not exist yet. | Platform owner, Finance owner | None | No automated entitlement change. Access is managed by hand. | `docs/SUBSCRIPTIONS.md` "Boundaries"; `packages/control-plane/README.md` |
| R-54 | Decide the TO DECIDE items in `docs/SUBSCRIPTIONS.md`: grace length and who sets it; immediate or end-of-period cancellation; reactivation; trial length and refunds; real plans and price-id mapping; more than one subscription per application; ordering key; expiry sweep; authority for webhook writes; retention of billing events; dead-letter limit. | Platform owner, Finance owner | None | Access rules are implemented from placeholders. | `docs/SUBSCRIPTIONS.md` "TO DECIDE" items 1 to 11 |
| R-55 | Supercharged payment secrets (Stripe webhook secret, a new Stripe secret key to replace the current one, YooKassa credentials, webhook token) are supplied by the owner before deploy. Do not paste values into tickets or PRs. | Product owner (Supercharged) | Provider accounts | Webhooks fail closed. Or the old key remains active. | `supercharged/STATUS.md` "Owner actions before deploy" |

## 8. Launcher, sessions and operator surfaces

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-56 | Decide the Central session loader design (how the launcher reads its own sign-in session). It depends on R-44 and the sign-in route and cookie policy. | Platform owner | R-01, R-44 | The launcher cannot list the signed-in organisation's products. | `docs/LAUNCHER_OIDC.md` "Components" |
| R-57 | Register the Logto post-logout and global logout URIs, then enable the gated global logout routes. Global logout needs the app session loader. | Logto admin, Platform owner | R-56 | Logout is local only. Sessions survive a sign-out elsewhere. | `docs/APP-BUILDER-INTEGRATION.md` section 8 |
| R-58 | Decide which roles may read activity events and whether activity export is needed. Each support read must be audited. No operator read path exists yet. | Platform owner, Legal/privacy reviewer | R-19 | Support staff can read tenant activity beyond their role. | `docs/RETENTION.md` section 6 |
| R-59 | Decide whether the support console is mounted, and under which role model. It is implemented but not mounted by default. | Platform owner | R-58 | No support path, or an unreviewed one. | `docs/SUPPORT_CONSOLE.md`; `docs/APP-BUILDER-INTEGRATION.md` section 8 |

## 9. Cross-product host and acceptance tasks

| ID | Item | Owner role | Prerequisite | Risk if skipped | Source |
|---|---|---|---|---|---|
| R-60 | Sorted: confirm the garonhome.local production host state before the next deploy. This covers the systemd unit `ai-fsm`, the nightly backup cron, the rclone remote, the health monitor cron, the NPM host, LAN DNS and the Cloudflare Tunnel origin. | Host operator (Sorted) | Owner authorisation for that release | Sorted deploys to a path that is not production, or a backup gap goes unnoticed. | `sorted/docs/working/deployment-target-decision-2026-11-08.md` "Unverified" |
| R-61 | Sorted: take a backup before each deploy (the deploy script does not), fix the unbounded healthy wait, and run a restore drill. | Host operator (Sorted) | R-60 | No recovery point before a deploy. | `sorted/docs/working/deployment-target-decision-2026-11-08.md` "Known gaps" |
| R-62 | Sorted: complete the production readiness checklist with a PASS or FAIL per row. This needs a green CI run URL, a cross-tenant RLS check, a Docker image secret check, and a login rate-limit check on a running stack. | Product owner (Sorted) | Docker stack running | Sorted goes to production with no recorded gate evidence. | `sorted/docs/PROD_READINESS_CHECKLIST.md` sections 1 to 3 |
| R-63 | Supercharged: confirm `TRUST_PROXY` so the real client IP is used, confirm the public webhook URL (O-24) before any provider is configured, and confirm ElevenLabs signs SIP webhooks. | Product owner (Supercharged), Host operator | R-40 | Rate limits and webhook authentication are keyed to the proxy address. | `supercharged/HANDOFF.md` "Open items"; `supercharged/STATUS.md` |
| R-64 | Supercharged: fix the migration runner list (008 and 009 have no files, 0011 and 0013 are omitted), restore `drizzle.config.ts`, and record the live row counts before the migration endpoint is deleted. | Product owner (Supercharged), DBA | Live database access | Migration runs fail or skip files. The endpoint is removed while live data is still unknown. | `supercharged/STATUS.md` "Open decisions" |
| R-65 | Supercharged: decide the held patches (SEC-06, play-audio HMAC), the workforce preview seeding, the campaign table collision, and the module flag defaults. | Product owner (Supercharged) | None | Held security patches stay unapplied. A legacy table is overwritten. | `supercharged/STATUS.md` "Open decisions" |
| R-66 | Supercharged: run the Titan Field bridge in shadow mode only after the owner sets `TITAN_FIELD_BRIDGE_MODE`. It fails closed until then. | Product owner (Supercharged) | R-35 | Bridge stays closed, or is opened without a review. | `supercharged/STATUS.md` "Other mounts" |
| R-67 | Skilled: operate the credential CLI on the host to create, rotate and revoke integration credentials. Apply the Prisma migrations and generate the client before use. | Product owner (Skilled), DBA | Skilled PostgreSQL | Integration credentials are not issued, or are issued without rotation. | `skilled/PASS17-CREDENTIALS.md`; `skilled/PASS18-CREDENTIAL-OPERATIONS.md` |
| R-68 | Scheduled: apply `scheduled/docs/deployment/nginx-security.conf` inside the site's server block so release manifests and evidence are not served. | Host operator (Scheduled) | Scheduled host | Engineering evidence is public at document root. | `scheduled/docs/deployment/nginx-security.conf` |
| R-69 | Docker-based acceptance. The product-selection proxy smoke test uses `docker run --network none`. The PostgreSQL TLS script needs a running `postgres:16` container. Both need a Docker host. | Platform owner, CI owner | Docker host or CI runner | Those checks do not run in this environment and are not counted as passed. | `deploy/proxy/nginx/product-selection-syntax-smoke.sh`; `packages/config-engine/scripts/enable-postgres-tls-ci.sh` |
| R-70 | Database-dependent Central tests. Several tests skip unless `TITAN_FLAG_TEST_DATABASE_URL` or `TITAN_CI_DATABASE_URL` is set. Set `TITAN_REQUIRE_DB_TESTS=1` in any environment where a skip must fail. | CI owner | PostgreSQL 16 service | Database-backed behaviour (RLS, roles, rollback) is not exercised, and the skip looks like a pass. | `apps/control-api/test/feature-flags-postgres.test.mjs`; `tests/test_login_role_path.py` |
| R-71 | Production cutover requires external approval evidence and a signed off-database receipt. Confirm the approval process and who holds the signing key. | Platform owner | R-16 | A cutover proceeds with no independent approval record. | `database/README.md` pass 21; `docs/integration/central-main-launcher-reconciliation.md` "Migration numbering" (CI blocks cutover without approval evidence) |
| R-72 | Run the Scheduled and Central link end to end on staging (sign in, link, verify, unlink). It needs staging Logto, staging products and the keys from R-22 to R-24. | Platform owner, Product owners | R-02, R-22 to R-25 | Link behaviour is verified only against fixtures. | `docs/LINKING.md` "Skilled fixture alignment"; `docs/APP-BUILDER-INTEGRATION.md` |

## 10. Preflight gates to flip only on evidence

| Gate (`deploy/staging.example.json`) | Evidence needed | Owner role | Items |
|---|---|---|---|
| `central_db_separate` | Central database separated and role-checked | DBA | R-10, R-11 |
| `logto_db_separate` | Logto database separated | DBA | R-10 |
| `supported_postgres` | Supported PostgreSQL version confirmed for the pinned Logto release | DBA | R-09 |
| `app_adapter_implemented.{desk,field,academy}` | Product adapters built and tested | Product owners | R-25, R-43 |
| `real_logto_verified` | Staging Logto sign-in, logout and rollback passed | Logto admin | R-02, R-07 |
| `migration_verified` | Migrations applied to a restored copy with checksum verified | DBA | R-12, R-13 |
| `two_tenant_test_passed` | Cross-tenant test passed against a real database | Platform owner | R-11, R-28, R-72 |
| `global_logout_test_passed` | Global logout passed on staging | Logto admin | R-57 |
| `rollback_test_passed` | Rollback rehearsed on staging | Host operator | R-20, R-51 |

Scheduled has no gate in this file. Add one when R-14 and R-27 are decided.

---

## Decisions in this register (for owner review)

1. R-15: the staged drafts are listed for archive or deletion, not deleted. Conservative default: keep them until the owner signs off.
2. R-14: Scheduled's registration is listed against the canonical chain because that is where the only `scheduled` migration sits. The owner must confirm the chain.
3. Items that depend on Docker or PostgreSQL 16 (R-69, R-70) are recorded as not run here, so they are not counted as passed.
4. The product-side items (R-25, R-60 to R-67) are listed for the product owners. They are not Central work.
