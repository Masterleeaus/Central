# Centrally governed configuration and feature flags (issue #38)

Status: **implemented, not yet deployed**. The data model (migration `0013_feature_flags.sql`), the resolver, the change and rollback functions, the PostgreSQL adapter, the server-to-server read endpoint (section 4), and the operator change path (section 5) are in this repository. The read endpoint is served only when `TITAN_CONFIG_READ_PRODUCTS` is set, and the change route only when `TITAN_OPERATOR_FLAG_CHANGES=1`. No product reads Central configuration yet, and no flag is declared yet (`apps/control-api/src/config-declarations.mjs` is empty).

## 1. Scope and limits

- Flags are typed and declared in code: `packages/control-plane/src/feature-flags.ts`. A flag that is not declared cannot be read or changed.
- Products are `sorted`, `supercharged`, `lms` and `central`. Environments are `development`, `staging` and `production`. Each (product, environment) pair has its own rows.
- The Sorted, Supercharged and LMS repositories are not attached to this session. Their product-side behaviour below is a requirement on those teams, not something verified here.
- No secrets, no code and no free-form strings are stored. Values are a boolean, one of a declared list of strings (enum), or a bounded integer.

## 2. Data model

Each flag has a declaration (in code) and one or more scope rows (in `titan.feature_flags`):

| Field | Meaning |
| --- | --- |
| `product`, `environment`, `flag_key` | Identity. `flag_key` matches `^[a-z][a-z0-9_]{0,63}$`. |
| `flag_type` | `boolean`, `enum` or `integer`. |
| `allowed_values` | `[true, false]` for boolean; a list of distinct strings for enum; `{"min", "max"}` for integer. |
| `default_value` | The declared default. Must be valid for the type. |
| `owner` | A team or person responsible for the flag. Required. |
| `organisation_id` | UUID of the organisation, or NULL for the global scope. |
| `value` | The value this row serves. |
| `rollout_percent` | 0 to 100, global rows only. Mutually exclusive with `cohort`. |
| `cohort` | A cohort name, global rows only. Mutually exclusive with `rollout_percent`. |
| `expires_at` | Required on organisation overrides. Optional on global rows. |
| `revision` | Starts at 1 and advances by exactly one on each change. |

`titan.feature_flag_history` records every change, append-only: `action` (`create`, `set` or `rollback`), the revision, the full snapshot, `actor`, `reason`, and for a rollback the revision it restored.

### Database enforcement (migration 0013)

- CHECK constraints reject a value whose type or content does not match the declaration, a default of the wrong type, malformed allowed values (duplicate enum entries, `min > max`, a boolean list other than `[true, false]`), an unknown product or environment, a malformed key or cohort, an empty owner, a rollout outside 0 to 100, an override without an expiry, and an override with a rollout or cohort.
- A unique constraint allows one row per (product, environment, key, organisation), with a NULL organisation treated as one value.
- Triggers write a history row on every INSERT and UPDATE in the same transaction. A change without `titan.change_actor` and `titan.change_reason` is refused. The revision must advance by exactly one. The scope cannot be changed in place.
- History rows cannot be updated, deleted or truncated (trigger). The trusted writer role has no UPDATE or DELETE grant on history.
- `titan.feature_flag_rollback(...)` restores the values of a history revision as a new revision. It refuses a stale expected revision, an unknown revision, and any snapshot whose expiry has passed.

Only the trusted reader and trusted writer roles (migrations 0006 to 0008) can reach these tables. The tenant role has no grant.

## 3. Resolution

For one flag and one verified organisation, the first matching rule wins:

1. **Organisation override**: an override row for the organisation that has not expired.
2. **Cohort**: a global row with a cohort, when the verified context lists that cohort.
3. **Rollout**: a global row with `rollout_percent`, when the organisation's bucket is below it. The bucket is `SHA-256(organisation_id NUL flag_key)`, first four bytes as an unsigned integer, modulo 100. It is deterministic: the same organisation and flag always get the same bucket, and raising the percentage only adds organisations.
4. **Global**: a global row with no targeting serves its value to everyone.
5. **Declared default**.

An expired row is ignored and resolution moves to the next rule. These fallbacks always return the declared default, never an arbitrary value:

- the store is unavailable, or does not answer within the read deadline (default 1 second);
- a stored row does not match its declaration (type, allowed values, default or owner) or is for another scope.

An undeclared flag, or a request that carries a field other than `product`, `environment` and `key`, is an error and is not resolved to a default.

## 4. Server-to-server read interface

Implemented in `apps/control-api/src/config-read.mjs`, mounted in `app.mjs` and enabled by `TITAN_CONFIG_READ_PRODUCTS` (comma-separated products, for example `sorted,lms`). Unset means the route answers 404.

- **Route**: `GET /internal/v1/config/{environment}/{flag_key}`. Served only on the internal listener, never through the browser-facing proxy.
- **Caller identity**: the calling product authenticates with a client-credentials token whose audience is that product (`urn:titan-central:product:<product>`). Central verifies the token signature, audience and expiry before any other step.
- **Product**: taken from the verified token, never from the path, query or body. A product cannot read another product's flags.
- **Organisation**: taken from the verified tenant claim on the token, passed to `trustVerifiedContext`. Any `organisation_id`, `organisationId`, `tenant` or cohort field in the query string or body is rejected with 400. Clients cannot choose their tenant or cohort.
- **Success (200)**: `{ "key": "<flag_key>", "value": <boolean|string|integer>, "source": "override|cohort|rollout|global|default|fallback", "revision": <integer or null> }`. `source` lets the product log which rule applied.
- **Unknown flag (404)**: `{ "error": "undeclared_flag" }`.
- **Auth failure (401 or 403)**: no value is returned.
- **Store failure**: the endpoint still answers 200 with the declared default and `source: "fallback"`. The product must not treat that as an error and must not cache it. A 5xx is returned only if Central cannot produce a response at all.
- **Cache**: a product may cache a 200 response from a non-fallback source for at most 60 seconds. It must not cache a `fallback` response.

### 4.1 Verified context mapping

The read path uses the existing access-token verifier (`createOidcVerifier` in `apps/control-api/src/oidc.mjs`), with one verifier per product audience. Each verifier accepts only its own audience, so a token minted for one product cannot be used for another. The verifier returns the named claims it was asked for, and only after the signature, issuer, audience and expiry checks.

| Input | Source | Rule |
| --- | --- | --- |
| Product | Audience that matched: `urn:titan-central:product:<product>` | Must be a value in `FLAG_PRODUCTS`. Never read from the path, query or body. |
| Environment | Path segment | Must be `development`, `staging` or `production`. |
| Organisation | Claim `titan_organisation_id` | UUID string, lower-cased. Absent or null means the global scope (`organisation_id` NULL). Any other value makes the token unauthenticated (401). |
| Cohorts | Claim `titan_cohorts` | Array of up to 32 cohort names. Absent means none. Malformed means 401. |
| Subject | Claim `sub` | Service client identity. Not used for targeting and not logged. |

These claim names are a deployment contract with the token issuer. Logto must add `titan_organisation_id` and `titan_cohorts` to the service tokens for the product audiences. This repository does not configure Logto, and that is not verified here. A token without these claims is still valid, but it reads only global values. The verified context is built by `verifiedContextFromClaims` and passed to `trustVerifiedContext`, which is the only way to create one.

### 4.2 Request and response

- `GET /internal/v1/config/{environment}/{flag_key}`, with no query string. A query string of any kind returns 400 `unexpected_parameter` before the store is touched.
- Authentication failure: 401 `unauthenticated`. A verified identity whose product is not in `FLAG_PRODUCTS`: 403 `unknown_product`. Neither returns a value.
- Undeclared key: 404 `undeclared_flag`. Invalid environment or key syntax: 400.
- Success: 200 `{ "key", "value", "source", "revision" }` with `Cache-Control: no-store`.
- Store unavailable, timed out, or holding an invalid row: 200 with the declared default and `source: "fallback"` and `revision: null`. It is not an error.
- Rate limit: the same per-IP limiter as `/v1/access/check`, applied before token verification.

**Deployment requirement.** The endpoint is on the same loopback listener as the access check. The reverse proxy in front of Central must not route `/internal/` or `/v1/admin/` to the public internet. This is a deployment control, not enforced in code.

### 4.3 Product-side contract (other repositories; not verified here)

The Sorted, Supercharged and LMS repositories are not attached to this session. Nothing below has been implemented or tested in those products. It is the contract this repository expects them to meet.

- The product's compiled-in default for each flag must match the Central declaration.
- A `fallback` response must not be cached. A `default` or non-fallback 200 may be cached for at most 60 seconds.
- On timeout, non-200, or a value that is not valid for the flag's type, the product uses its compiled-in default. It does not keep an earlier value and does not fail the request.
- The product must not read a flag it did not declare, and must not send tenant or cohort data.

### Product-side rules (summary of 4.3)

- A product ships with a compiled-in default for every flag it reads. That default must match the Central declaration.
- If Central is unreachable, times out, returns a non-200 response, or returns a value that is not valid for the flag's type, the product uses its compiled-in default. It does not keep an earlier value and does not fail the request.
- A product must not read a flag it did not declare, and must not send tenant or cohort data in the request.

## 5. Change control

- Every change requires: the scope, the **expected revision** the operator last read (0 to create), the new value or targeting, an `actor` and a `reason`. A mismatched expected revision is refused with no write.
- An organisation override requires `expires_at` in the future. Overrides are for temporary use and expire on their own.
- A rollback names the history revision to restore. It is recorded as a new revision with `action = 'rollback'`. It does not edit or remove any history row.
- **Route**: `POST /v1/admin/flags/change`, served only when `TITAN_OPERATOR_FLAG_CHANGES=1` and the operator plane is configured. Otherwise 404. Off by default.
- **Authorisation**: the same path as the other admin routes. The bearer token is verified, then `createLogtoOperatorAuthoriser` checks Logto organisation membership and an administrator role at decision time. Denied is 403, and an unavailable authority is 503. The change is not attempted in either case.
- **Body**: `op` is `set` or `rollback`. Fields: `product`, `environment`, `key`, `organisationId` (UUID or null, the scope the operator is changing, not a tenant from the request), `expectedRevision`, `reason`. A `set` also takes `value`, and optionally `rolloutPercent`, `cohort`, `expiresAt`. A `rollback` takes `toRevision`. Unknown fields are refused, including `actor`.
- **Actor**: the verified operator subject (`logtoSubject`). It is written to history by the database trigger and cannot be supplied by the client.
- **Responses**: 200 `{ "status": "changed", "revision" }`. 409 `stale_revision` when `expectedRevision` is not the current revision, with nothing written. 400 for invalid values, targeting or rollback. 404 `undeclared_flag`. 503 `flag_store_unavailable`.
- **Scope of the organisation field**: this field is accepted on the change path only. It is the operator's choice of scope and is authorised by the operator check. The read path never accepts an organisation from the client.

## 6. Verification

- Node tests (`packages/control-plane/test/feature-flags.test.mjs`) run against an in-memory store that uses the same commit rule as the database. They cover registry rejection, precedence, expiry, deterministic bucketing, tenant targeting from the verified context, store failure and timeout, invalid stored rows, stale-revision rejection, rollback and history.
- SQL test (`tests/sql/feature_flags.sql`) runs against PostgreSQL 16. It covers the CHECK constraints, the audit requirements, history immutability, the grants for the trusted writer, and rollback.
- `apps/control-api/test/config-read.test.mjs` and `config-admin.test.mjs` cover the read endpoint, the change path, the claim mapping, and a real RS256 token through `createOidcVerifier`. They use an in-memory store with the same commit rule.
- `apps/control-api/test/feature-flags-postgres.test.mjs` runs the PostgreSQL adapter, the resolver and the read endpoint against a real server. It is skipped unless `TITAN_FLAG_TEST_DATABASE_URL` is set. The URL logs in as `titan_central_app`, a NOINHERIT member of `titan_trusted_reader` and `titan_trusted_writer`, on a database with migrations 0001 to 0009 and 0013. It covers stale and concurrent revisions, override expiry, rollback, history immutability for the writer role, and fallback on an unreachable database.
