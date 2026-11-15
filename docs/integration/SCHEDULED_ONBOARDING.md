# Scheduled onboarding to Titan Central (operator runbook)

Status: runbook draft. Nothing in this document has been run against a live system.
Scope: connecting the Scheduled product (product id `scheduled`) to Titan Central.
Scheduled owns bookings. Central does not own Scheduled's booking records.

## How to use this runbook

- Work top to bottom. Do not skip a phase.
- Every step that needs an operator, a live system, a real secret or a production host is marked **OPERATOR ONLY**.
  Automated agents and CI must not execute an OPERATOR ONLY step. They may read this file and check the repository.
- Steps marked **BLOCKED** depend on a code or configuration change that is not in the repository today. Do not
  start the live phase until every blocker in section 1 is closed and merged.
- Never paste a secret, private key, client secret or full `.env` file into a ticket, chat, pull request, log or
  this repository. Record variable names and key IDs only.

## 0. Reference values (not secrets)

| Item | Value | Source |
| --- | --- | --- |
| Product id | `scheduled` | Central migration `database/migrations/0013_scheduled_product_registration.sql` |
| Service audience | `urn:titan-central:product:scheduled` | Brief; same pattern as `docs/PRODUCT_REGISTRY.md` |
| Link assertion `aud` | `titan-central` (exact) | `docs/LINKING.md`; Scheduled `scheduled/src/link-assertion.js` |
| Link assertion `typ` / `alg` | `titan-link+jwt` / `EdDSA` | `docs/LINKING.md` |
| Link assertion lifetime | at most 300 seconds | `docs/LINKING.md` |
| Events signature | hex HMAC-SHA256 over canonical JSON, per route secret | `docs/EVENTS.md` |
| Event secret minimum | 32 characters | Scheduled `core/app/Central/Config/CentralConfig.php` (`MIN_SECRET_LENGTH`) |
| Central migration chain | `database/migrations/` (canonical). Do not use `migrations/` for this | `database/README.md`, `tools/migrate_shared.py` |

## 1. Blockers to close before any live step

These are gaps found by reading the repositories. Each one must be closed in code or configuration, reviewed and merged
first. This runbook does not close them.

| # | Gap | Where | Effect if skipped |
| --- | --- | --- | --- |
| B1 | `scheduled` is not in the link-key product set. `PRODUCT_IDS` holds `sorted`, `supercharged`, `lms` only, and the key-set array is capped at that length. | `apps/control-api/src/link-key-config.mjs`, `packages/control-plane` `PRODUCT_IDS` | Central refuses to start with a `scheduled` key set. |
| B2 | `scheduled` is not in the product-registry allowlist, and there is no Scheduled origin variable (`TITAN_SCHEDULED_ORIGIN`). The registry has three products. | `docs/PRODUCT_REGISTRY.md`, `apps/control-api/src/operator-config.mjs` | No validated service origin for Scheduled. |
| B3 | `scheduled` is not in `FLAG_PRODUCTS`, so Scheduled cannot read centrally governed flags. | `packages/control-plane/src/feature-flags.ts` | Only needed if Scheduled reads flags. Not needed for sign-in or events. |
| B4 | `scheduled` is not in the `activity_events.source_product` check. | `migrations/0011_activity_events.sql` (line 60) | Scheduled activity cannot be recorded. |
| B5 | Central's token verifiers accept only the three application audiences. A Scheduled sign-in audience needs its own environment variable and verifier. | `deploy/env.example` (`TITAN_*_AUDIENCE`), `docs/LAUNCHER_OIDC.md` | Scheduled sign-in tokens are rejected. |
| B6 | The outbox event registry is empty. No business event can be published to Scheduled until a reviewed registry entry exists. | `docs/EVENTS.md`, `PRODUCTION_EVENT_REGISTRY` in `packages/control-plane/src/outbox.ts` | Routes are configured but nothing is delivered. |
| B7 | `deploy/preflight.py` checks only `desk`, `field` and `academy`. It does not check Scheduled at all. | `deploy/preflight.py` (`APPS`) | A green preflight says nothing about Scheduled. Use section 9 as the manual check. |
| B8 | Scheduled's `scheduled/src/nonce-store.js` is in memory. Multi-instance deployment needs a shared store. | Scheduled `scheduled/src/nonce-store.js` | Replay protection is per process only. Run one instance, or close this first. |
| B9 | Scheduled's `.env.example` names `CENTRAL_OIDC_*` variables only. The PHP code also reads `CENTRAL_OIDC_CLIENT_SECRET`, `CENTRAL_SERVICE_CLIENT_SECRET` and `CENTRAL_EVENTS_HMAC_SECRET`, and the Node link package reads `SCHEDULED_*` variables. None of the secrets appear in the example. | Scheduled `.env.example`, `core/app/Central/Config/CentralConfig.php`, `scheduled/src/config.js` | Operators can miss a required value. Section 6 lists every name. |

Decision needed for B1 to B6: the owner confirms that Scheduled is a fourth canonical product. Until then, this
runbook assumes it is.

## 2. Logto OIDC client for Scheduled sign-in (OPERATOR ONLY)

Logto is the upstream identity service. Titan Central does not create Logto applications from code.

1. **OPERATOR ONLY.** In the Logto console, create a **confidential** Traditional web application for Scheduled. Use the
   same client type as the other product applications (see `docs/UPSTREAM.md`).
2. **OPERATOR ONLY.** Set the redirect URI to the exact callback that Scheduled serves, for example
   `https://<scheduled-host>/auth/titan/callback`. The value must match `CENTRAL_OIDC_REDIRECT_URI` character for character.
   No wildcards, no query string.
3. **OPERATOR ONLY.** Set the post-logout redirect URI to the Scheduled public origin. Confirm the origin with the owner
   first.
4. **OPERATOR ONLY.** Scopes: `openid profile email`, the same as the other applications. Decide on the organisation scope
   before the first live sign-in. Do not decide it by default.
5. **OPERATOR ONLY.** Record the application ID (`CENTRAL_OIDC_CLIENT_ID`) and the client secret. The secret goes only
   into the server environment file, owned `root:root` with mode `0600`.
6. **OPERATOR ONLY.** Choose the sign-in audience (`CENTRAL_OIDC_AUDIENCE`). It must differ from every other product
   audience (ADR-005). Do not guess it. Central must also accept it (blocker B5).
7. **OPERATOR ONLY.** Confirm the discovery URL (`CENTRAL_OIDC_DISCOVERY_URL`) is on the same origin as
   `CENTRAL_ORIGIN`.

## 3. Service client for server-to-server calls (OPERATOR ONLY)

1. **OPERATOR ONLY.** In Logto, create a machine-to-machine (client credentials) application for Scheduled's service
   calls. Record its ID as `CENTRAL_SERVICE_CLIENT_ID` and its secret as `CENTRAL_SERVICE_CLIENT_SECRET`.
2. **OPERATOR ONLY.** Set the token audience to `urn:titan-central:product:scheduled`. Each Central verifier accepts only
   its own product audience (`docs/CONFIG.md` section 4.1). Do not reuse an
   audience of another product.
3. **OPERATOR ONLY.** Grant only the scopes Scheduled needs. Record the scope list in the change ticket.
4. **OPERATOR ONLY.** If Scheduled will read Central flags, Logto must also add the `titan_organisation_id` and
   `titan_cohorts` claims to that audience's tokens. This needs blocker B3 closed first.

## 4. Events secret per route (OPERATOR ONLY)

Central publishes events to Scheduled with one HMAC secret per route. Scheduled verifies with the same value.

1. **OPERATOR ONLY.** Generate a random secret of at least 32 characters on a trusted workstation. Do not generate it in
   a chat or a repository. Example: `openssl rand -base64 48`.
2. **OPERATOR ONLY.** Store the secret in Central's secret store under a variable name, for example
   `TITAN_OUTBOX_SECRET_SCHEDULED`. The name goes in the route; the value does not.
3. **OPERATOR ONLY.** Add a route to `TITAN_OUTBOX_ROUTES` in the outbox worker environment. The route names the secret
   variable with `secretEnv`. Shape, from `deploy/outbox-worker.env.example`:

   ```
   {"consumer":"scheduled","organisationId":"<tenant uuid>","eventTypes":["<approved event type>"],"url":"https://<scheduled-host>/<approved inbound path>","secretEnv":"TITAN_OUTBOX_SECRET_SCHEDULED"}
   ```

   Use exactly one of `secretEnv` or `keys` per route. Do not use both. Do not put the secret inline.
4. **OPERATOR ONLY.** Set `CENTRAL_EVENTS_HMAC_SECRET` in Scheduled's server environment to the same value. Each route
   has its own secret. Do not reuse a secret across routes.
5. **OPERATOR ONLY.** For rotation, use the two-key form documented in `docs/EVENTS.md` ("Key rotation"). Leave a
   margin of several minutes between the two windows.
6. The URL must be `https`. `http` is accepted only for `localhost` with `TITAN_ALLOW_INSECURE_LOCALHOST=1`, and that
   must never be set in staging or production.
7. Blocker B6 applies. Do not add a route for an event type that is not in the reviewed registry.

## 5. Link signing key pair (OPERATOR ONLY)

Scheduled signs link assertions with an Ed25519 private key. Central holds only the public key. The private key never
leaves Scheduled's server environment.

1. **OPERATOR ONLY.** Generate an Ed25519 private key on a trusted workstation, in PKCS8 PEM form, for example
   `openssl genpkey -algorithm ed25519 -out <path-outside-the-repo>`. Store the file with mode `0600`. Never commit it.
   The repository has no key generator; this is the standard OpenSSL command.
2. **OPERATOR ONLY.** Set on the Scheduled host, in the Node link package environment:
   - `SCHEDULED_CENTRAL_ORIGIN` (the Central origin, no path, query or fragment; `https` except localhost)
   - `SCHEDULED_CENTRAL_AUDIENCE` set to `titan-central`
   - `SCHEDULED_PRODUCT_ID` set to `scheduled`
   - `SCHEDULED_LINK_KEY_ID` set to a key ID of 1 to 64 letters, digits, `.`, `_` or `-` (for example `scheduled-2026-11`)
   - `SCHEDULED_LINK_PRIVATE_KEY_PEM` holding the PEM from step 1 (set from the file; never echoed to a log)
3. **OPERATOR ONLY.** Export the public key. Run the script from the Scheduled Node package directory, with the
   variables from step 2 set in the shell, not in a file that is committed:

   ```
   node scripts/export-public-jwk.js > <output-file-outside-the-repo>
   ```

   The script prints the public key only. It also needs the private key to be present in the environment, because its
   loader requires it.
4. **OPERATOR ONLY. Manual mapping required.** The script output has `kty`, `crv`, `x`, `kid`, `alg` and `use` at the top
   level. Central's key set accepts only `kty`, `crv` and `x` inside `jwk`. Build the key entry by hand:

   ```
   { "productId": "scheduled", "keys": [
       { "kid": "<SCHEDULED_LINK_KEY_ID>", "alg": "EdDSA",
         "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "<x from the script>" },
         "notBefore": "<RFC 3339 time with offset, before the first assertion>" } ] }
   ```

   Do not include `d`, `use`, `kid` or `alg` inside `jwk`. Add `notAfter` only when retiring the key.
5. **OPERATOR ONLY.** Central must load this set through `TITAN_LINK_KEYS_FILE` (a file path) or `TITAN_LINK_KEYS_JSON`
   (inline JSON). Set at most one. Prefer the file, owned by the Central service user. Blocker B1 applies.
6. **OPERATOR ONLY.** Rotation: publish the new key in Central with `notBefore` no later than the first assertion
   signed with it. Switch `SCHEDULED_LINK_KEY_ID` after that. Set `notAfter` on the old key once every assertion under it
   has expired (at least 5 minutes).
7. **OPERATOR ONLY.** Compromise: set `notAfter` on the key to the current time. This stops new assertions. It does not
   revoke links already created. Review links created in the exposure window.

## 6. Environment variable inventory (names only)

Set these in the Scheduled server environment, owned `root:root` with mode `0600`. Never commit values.

| Variable | Used by | Secret | Notes |
| --- | --- | --- | --- |
| `CENTRAL_ORIGIN` | PHP | no | Central origin. |
| `CENTRAL_OIDC_DISCOVERY_URL` | PHP | no | Same origin as `CENTRAL_ORIGIN`. |
| `CENTRAL_OIDC_CLIENT_ID` | PHP | no | Section 2. |
| `CENTRAL_OIDC_CLIENT_SECRET` | PHP | yes | Missing from `.env.example`. Section 2. |
| `CENTRAL_OIDC_AUDIENCE` | PHP | no | Section 2, step 6. |
| `CENTRAL_OIDC_REDIRECT_URI` | PHP | no | Exact match with the Logto redirect URI. |
| `CENTRAL_SERVICE_CLIENT_ID` | PHP | no | Section 3. |
| `CENTRAL_SERVICE_CLIENT_SECRET` | PHP | yes | Missing from `.env.example`. Section 3. |
| `CENTRAL_EVENTS_HMAC_SECRET` | PHP | yes | At least 32 characters. Same value as the Central route secret. Missing from `.env.example`. |
| `TITAN_ALLOW_INSECURE_LOCALHOST` | PHP | no | Never `1` in staging or production. |
| `SCHEDULED_CENTRAL_ORIGIN` | Node link package | no | Section 5. |
| `SCHEDULED_CENTRAL_AUDIENCE` | Node link package | no | Must be `titan-central`. |
| `SCHEDULED_PRODUCT_ID` | Node link package | no | Must be `scheduled`. |
| `SCHEDULED_LINK_KEY_ID` | Node link package | no | Key ID. |
| `SCHEDULED_LINK_PRIVATE_KEY_PEM` | Node link package | yes | Ed25519 private key. Never in the repository. |

Central side (names only, in the Central environment and the outbox worker environment): `TITAN_LINK_KEYS_FILE` or
`TITAN_LINK_KEYS_JSON`, `TITAN_OUTBOX_ROUTES`, `TITAN_OUTBOX_DATABASE_URL`, and the route secret variable named in
`secretEnv`. Origin allowlist: `TITAN_PRODUCT_TRUSTED_ORIGINS` (section 7).

## 7. Origin allowlist entries (OPERATOR ONLY, after B2)

1. **OPERATOR ONLY.** Add the Scheduled service origin to `TITAN_PRODUCT_TRUSTED_ORIGINS` once B2 adds the
   Scheduled origin variable. Today the allowlist covers the three existing origins only. The list is comma separated.
2. Each origin must be `https`, on a public DNS name, on the default port, with no credentials, path, query or fragment.
   IP literals, `localhost` and GitHub hosts are refused.
3. No two products may share an origin.
4. **OPERATOR ONLY.** Add the Scheduled public origin to the Logto application (redirect and post-logout) from section 2.
5. **OPERATOR ONLY.** If the owner extends the deploy preflight to Scheduled (B7), add the Scheduled host to its
   `provisioned_hostnames`.

## 8. Migration (OPERATOR ONLY, staging first)

The Scheduled registration is `database/migrations/0013_scheduled_product_registration.sql`. It is forward-only and
modifies no tenant data. It replaces three CHECK constraints (`application_entitlements`, `application_company_links`,
`application_user_links`) to add `scheduled`.

Rules:

- Use only the canonical chain in `database/migrations/`. The runner is `tools/migrate_shared.py`. It refuses a chain
  with gaps and any checksum drift.
- Do not apply the legacy `migrations/` chain to the same database. Its file `migrations/0013_feature_flags.sql` has the
  same number and is a different migration. Do not confuse them.
- `integration/staged-central-browser-migrations/0013_central_company_selection.sql` is a third file numbered 0013. Do not apply it.
- Migrations 0001 to 0012 must already be applied and recorded in `titan.schema_migrations`.

Steps:

1. **OPERATOR ONLY.** Confirm, on the target database, that `titan.schema_migrations` holds 0001 to 0012 with the expected
   checksums. Use a read-only query. Record the output in the change ticket.
2. **OPERATOR ONLY.** Take a verified backup of the target database. Record the backup identifier.
3. **OPERATOR ONLY.** Dry run on a disposable copy, not on production:

   ```
   python3 tools/migrate_shared.py --database-url "<disposable-copy-url>" --dry-run
   ```

4. **OPERATOR ONLY.** Apply on the disposable copy. Confirm that `scheduled` is accepted by the three constraints and that
   `central` is still accepted by `application_entitlements`. The repository has no SQL test specific to 0013 yet; add one
   before production if the owner requires it.
5. **OPERATOR ONLY.** Apply to staging with the same command, without `--dry-run`, after a reviewed change approval.
6. **OPERATOR ONLY.** Apply to production only after staging passes and the owner approves. Use the same command.
7. **OPERATOR ONLY.** Confirm that `titan.schema_migrations` now holds `0013_scheduled_product_registration.sql` with the
   checksum recorded in the change ticket.
8. Rollback: the file is forward-only. Do not drop or edit the constraints by hand. If a rollback is needed, follow a
   separately reviewed backup restore or forward-repair plan.

## 9. Preflight checks

Run each check before the first live sign-in. Each check is read-only, but it runs on a live host or against a live
environment, so each one is OPERATOR ONLY.

### 9.1 Central deployment gate (OPERATOR ONLY)

```
python3 deploy/preflight.py --config <staging-config.json> --env-file <central.env>
```

- `--config` needs `deploy/staging.example.json`-shaped values from the owner.
- `--env-file` reports variable names only and checks the operator plane.
- Known limit (B7): this gate does not check Scheduled. A pass is not evidence that Scheduled is connected.
- The gate also requires `--root` and `--upstream` when it checks the source tree.

### 9.2 Scheduled installation check (OPERATOR ONLY)

On the Scheduled host, from the application root:

```
php scripts/preflight.php
php scripts/preflight.php --json
```

- Checks PHP version, extensions, required files, writable directories, and `core/.env` basics (`APP_DEBUG=false`,
  `APP_ENV=production`, `APP_KEY` format).
- Prints pass or block lines and exits non-zero on a block. It prints no secret values.
- Known limit: it does not check any `CENTRAL_*` or `SCHEDULED_*` variable, nor the link key. Those are checked in 9.3.
- Two of its checks are manual and always block: the web server access rule for `/core`, `/private` and `/integration`,
  and the MariaDB migration and booking acceptance together with payment and AI provider acceptance. Close those separately.

### 9.3 Manual Central connection checks (OPERATOR ONLY)

Record a pass or fail for each line in the change ticket.

| # | Check | How |
| --- | --- | --- |
| C1 | Every `CENTRAL_*` variable in section 6 is set and not a placeholder. | Check names and presence. Do not print values. |
| C2 | `CENTRAL_OIDC_REDIRECT_URI` equals the registered Logto redirect URI. | Compare the two strings. |
| C3 | `CENTRAL_OIDC_DISCOVERY_URL` is on the `CENTRAL_ORIGIN` origin. | Compare origins. |
| C4 | `CENTRAL_EVENTS_HMAC_SECRET` is at least 32 characters and matches the Central route secret. | Compare with a hash on both sides, not the value. |
| C5 | `SCHEDULED_LINK_KEY_ID` appears as a `kid` in Central's key set, and `notBefore` has passed. | Read Central's key file. |
| C6 | Central starts with the `scheduled` key set (blocker B1 closed). | Startup log. Central fails fast on a bad key set. |
| C7 | A test link assertion signed with the private key is accepted by Central staging. Use a fixture identity, not a real customer. | Staging only. |
| C8 | `TITAN_ALLOW_INSECURE_LOCALHOST` is unset or `0` on the host. | Check the environment. |

## 10. Smoke test order (OPERATOR ONLY, staging)

1. Sign in to Scheduled through Central with a test identity on staging.
2. Confirm the Scheduled session is bound to the test organisation.
3. Create one link assertion, and confirm Central records one verified link. Then confirm a repeat of the same nonce is
   refused as replayed.
4. Confirm one outbox event for an approved event type is delivered and signed. Confirm a bad signature is refused.
5. Record the results. Do not use production identities.

## 11. Open decisions for the owner

- D1. Confirm `scheduled` is a fourth canonical product (closes B1 to B6 in principle).
- D2. Choose the Scheduled sign-in audience (step 2.6).
- D3. Decide whether Scheduled reads centrally governed flags (B3).
- D4. Confirm which process signs link assertions, since the signing code is in the Node package and the PHP
   application reads only `CENTRAL_*` variables.
- D5. Decide whether Scheduled must run on more than one instance before the nonce store (B8) is made durable.
- D6. Decide the organisation scope for the Logto client (step 2.4).
