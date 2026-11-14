# App builder integration with Titan Central

Status: **DRAFT**. This guide describes what Titan Central implements on `main` and what the product repositories
(Sorted, Supercharged, LMS) must still do. The product repositories are not attached to the Central repository, so
nothing here has been checked against their code. Each section links the source document it is taken from. Where a
source document is DRAFT, this guide says so.

Audience: engineers building Sorted (`sorted`, legacy `field`), Supercharged (`supercharged`, legacy `desk`) and LMS
(`lms`, legacy `academy`).

This guide contains no secret, key value or credential. Logto client details and the LMS domain are pending owner input
and are not given here.

## 1. Membership and the organisation column

Source: [`docs/LINKING.md`](LINKING.md) (Terms), [`docs/CONFIG.md`](CONFIG.md) section 4.1,
[`docs/PRODUCT_REGISTRY.md`](PRODUCT_REGISTRY.md), `migrations/0001_control_plane_draft.sql`, `migrations/0006_tenant_rls.sql`.

Central owns identity, organisation and membership:

- `titan.identities`: one row per Logto subject (`logto_subject`, unique). `state` is `active` or `blocked`.
- `titan.organisations`: one row per Logto organisation (`logto_organisation_id`, unique). `state` is `active` or
  `suspended`.
- `titan.memberships`: one row per (identity, organisation). Fields: `role` (`owner`, `admin`, `manager`, `member`,
  `learner`), `state` (`active`, `invited`, `suspended`, `revoked`), `expires_at` and `revision`.

Rules for products:

- Each product keeps its own rows. A tenant-scoped product row carries a tenant key set from the **verified**
  organisation claim of the token or link assertion. It is never taken from a request body, query string, form field
  or cookie.
- Membership is read from Central's membership row. Do not store a `company_id` on the user row as the source of
  membership.
- The per-product tenant key names in `PRODUCT_REGISTRY.md` (`account_id`, `company_account_id`, `companyRef`) are
  **assumptions** that Central has not verified. Do not treat them as settled column names until the owning product
  confirms them.
- The organisation claim has two names, one per token type. The link assertion carries `org` (LINKING.md). Service
  tokens used for configuration reads carry `titan_organisation_id` (CONFIG.md 4.1).
- `GET /v1/access/check` takes `organisation_id` as a parameter. Pass the organisation from your verified session, not
  from user input. Central checks the verified subject's membership in that organisation.

## 2. Product ids, legacy ids and audiences

Source: [`docs/PRODUCT_REGISTRY.md`](PRODUCT_REGISTRY.md) (Canonical products, Legacy-to-canonical mapping),
[`docs/LINKING.md`](LINKING.md) (Terms), `deploy/env.example`.

| Product id | Legacy id | Display name |
| --- | --- | --- |
| `sorted` | `field` | Sorted |
| `supercharged` | `desk` | Supercharged |
| `lms` | `academy` | LMS |

- **Product ids** (`sorted`, `supercharged`, `lms`) are used in the registry, in feature flags and in service audiences.
- **Legacy ids** (`field`, `desk`, `academy`) are used by `GET /v1/access/check` (`application`), in stored records and
  in local account links. They are not renamed. Do not relabel stored records.
- **User access token audiences.** Central accepts an access token only for the audience configured for the app. The
  operator sets these with `TITAN_FIELD_AUDIENCE`, `TITAN_DESK_AUDIENCE` and `TITAN_ACADEMY_AUDIENCE`. There is one
  audience per app. The values are set on the server and are not written in this guide.
- **Service token audiences.** `urn:titan-central:product:<product>`, for example `urn:titan-central:product:sorted`
  (PRODUCT_REGISTRY.md; CONFIG.md section 4). The service-token audience prefix is **DRAFT** (PRODUCT_REGISTRY.md).

## 3. Sign-in and logout

Source: `apps/control-api/src/oidc-login.mjs`, `oidc-cookie-policy.mjs`, `oidc-app-session.mjs`,
`oidc-global-logout.mjs`; [`PASS13_IMPLEMENTATION.md`](../PASS13_IMPLEMENTATION.md); [`PASS14_IMPLEMENTATION.md`](../PASS14_IMPLEMENTATION.md).

- **Protocol.** OpenID Connect Authorization Code flow with PKCE (`S256`). The request carries `state` and `nonce`.
  Each product app uses its own confidential Logto application.
- **Ownership.** Each product implements its own callback and its own session. Central's login helper is a reusable
  module and is not mounted into any running product route. Products rotate their own session on login.
- **Cookies.** Session and correlation cookies are host-only: no `Domain` attribute, `Path=/`, `Secure`, `HttpOnly`,
  and `SameSite=Lax` or `Strict`. No cross-subdomain cookie and no cross-application cookie. Sessions and passwords
  are never shared between apps.
- **App-local logout.** `POST /auth/titan/{application}/logout` revokes the app session and clears the host-only cookie.
  It does not end the Logto provider session.
- **Global logout.** `POST /auth/titan/global-logout` and the post-logout landing are mounted by
  `apps/control-api/src/server.mjs` through `global-logout-mount.mjs` (issue #6). They stay off unless
  `TITAN_GLOBAL_LOGOUT_ENABLED=1`. Enabling needs `TITAN_GLOBAL_LOGOUT_POST_URI` registered in Logto and an app-owned
  session loader, which does not exist yet, so the gate currently fails startup when on. Do not describe logout as
  global until that loader exists and it is tested across all three apps.

Status: DRAFT. Product-side sign-in is not implemented in this repository. The Logto applications are not yet
registered (issue #24).

## 4. Service-to-service calls

Source: [`docs/CONFIG.md`](CONFIG.md) section 4 and 4.1, [`docs/PRODUCT_REGISTRY.md`](PRODUCT_REGISTRY.md).

- A product calls Central with a **client-credentials** token from Logto. The audience is
  `urn:titan-central:product:<product>`.
- Central verifies the signature, the audience and the expiry before any other step. Each product audience has its own
  verifier, so a token minted for one product is rejected for another.
- Central takes the product from the verified audience. It never takes the product from the path, query or body.
- Service tokens must carry `titan_organisation_id` and `titan_cohorts` for organisation and cohort targeting. Logto must
  add these claims. This repository does not configure Logto, and the claims are not verified in a running system.
- Keep the client secret server-side, and out of code, logs and events.

Status: DRAFT (PRODUCT_REGISTRY.md: "client-credentials audience per product" is listed as DRAFT).

## 5. Endpoints

Sources: `apps/control-api/src/app.mjs` (routing), `apps/control-api/src/server.mjs` (what is mounted),
[`docs/CONFIG.md`](CONFIG.md), [`docs/SUPPORT_CONSOLE.md`](SUPPORT_CONSOLE.md),
[`docs/SKILLED-SERVICE-DECISION-CONTRACT-PASS18.md`](SKILLED-SERVICE-DECISION-CONTRACT-PASS18.md),
[`docs/PRODUCT_REGISTRY.md`](PRODUCT_REGISTRY.md).

### Endpoints a product may call

| Method and path | Caller | Authentication | Served when |
| --- | --- | --- | --- |
| `GET /v1/access/check?organisation_id=&application=&action=` | Product server, on behalf of a signed-in user | User access token for the app's audience | Always. `application` is `field`, `desk` or `academy`. Allow returns `200 {allowed, role, reason}`. Deny returns `403`. Rate limited per IP and per subject. |
| `GET /internal/v1/config/{environment}/{flag_key}` | Product server | Service token, audience `urn:titan-central:product:<product>` | Only when `TITAN_CONFIG_READ_PRODUCTS` names the product. Internal listener only. No query string is accepted. |
| `POST /v1/integrations/academy/decision` | LMS server only | `Authorization: Bearer` with a server-managed secret of at least 32 characters, not a Logto token | Only when `TITAN_SKILLED_DECISION_BEARER` is set. Opt-in. |
| `GET /healthz` | Operations | None | Always. Central's own health. It is not a product contract. |

Products expose `GET {origin}/titan/v1/health` and `GET {origin}/titan/v1/version`, which Central may probe. These paths
are DRAFT and nothing calls them at runtime (PRODUCT_REGISTRY.md).

### Operator-only endpoints

These are not product endpoints. A product must not call them.

| Path | Who | Notes |
| --- | --- | --- |
| `/v1/admin/*` (`POST /v1/admin/provision`, `GET /v1/admin/oidc/plans`, `POST /v1/admin/flags/change`) | Verified operator (Logto organisation role) | Mounted only when the operator plane is configured (`TITAN_OPERATOR_*`). The flag-change route also needs `TITAN_OPERATOR_FLAG_CHANGES=1`. Account-link writes go through `POST /v1/admin/provision` (LINKING.md). |
| `/v1/support/*` | Support role only | Read-only support console API. Not mounted by the default server (SUPPORT_CONSOLE.md). |
| `/v1/launcher/*` | Operator | **Not present on `main`.** Do not build against it. |

Routing rules that the deployment must keep (CONFIG.md 4.2): `/internal/` and `/v1/admin/` must not be routed to the
public internet. `/metrics` is bound to 127.0.0.1 and must not be forwarded by the reverse proxy.

## 6. Account linking

Source: [`docs/LINKING.md`](LINKING.md). The rules below are copied from that document. They are not restated in other
terms. Read the whole document before building the signer.

Status: **the Central verifier is implemented. The product side is not implemented in this repository.** Sorted,
Supercharged and LMS must add the signing described here before any link can be created in production.

### The assertion

The product signs a short-lived compact JWS:

- Header: `alg` = `EdDSA` (Ed25519), `typ` = `titan-link+jwt`, `kid` = the key ID. No other header fields.
- Signature: Ed25519 over the ASCII bytes of `header.payload`. The signing key is the product's private key, which Central
  never holds.

### Claims

| Claim | Value | Rule |
| --- | --- | --- |
| `iss` | product id, for example `sorted` | Must be a known product and must match the application being linked |
| `aud` | `titan-central` | Exact match |
| `sub` | Central identity subject | Must equal Central's own record for the identity |
| `org` | Logto organisation ID | Must equal Central's own record for the organisation |
| `lu` | local user ID | Opaque; must equal the command's `localUserId` |
| `la` | local account ID | Opaque; must equal the command's `localAccountId` |
| `nonce` | 128 bits or more, base64url, 22 to 128 characters | Single use per product |
| `iat` | issued-at, seconds since epoch | Not more than 30 seconds in the future |
| `exp` | expiry, seconds since epoch | Greater than `iat`; `exp - iat` at most 300 seconds; rejected at or after `exp` |

Identifier values (`sub`, `org`, `lu`, `la`) must match `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`. This rejects anything containing `@` (email) or whitespace (typical display names). The verifier cannot prove that an opaque-looking ID is not a name; the product contract must issue immutable IDs, not names.

These claims are forbidden, and an assertion carrying any of them is rejected: `email`, `email_verified`, `name`, `given_name`, `family_name`, `display_name`, `displayName`, `preferred_username`, `username`, `nickname`, `phone_number`.

The verification order is in LINKING.md, section "Verification order". Replay is checked last, so a rejected assertion
never spends its nonce.

### Key registration and rotation

Source: LINKING.md, "Keys and rotation" and "Nonce store and replay".

- One key set per product, held as operator configuration. Each key has a `kid`, a public JWK (`kty` `OKP`, `crv`
  `Ed25519`, `x`), `notBefore` and optionally `notAfter`.
- Public keys only. A JWK with `d` or any member other than `kty`, `crv` and `x` is refused at construction. So is any
  non-Ed25519 key, duplicate product sets, duplicate `kid` values, or more than 8 keys per product.
- Keys come from operator configuration. They are never read from a request, a product or a token header.
- Rotation: publish the new key with `notBefore` no later than the first assertion signed with it. Products switch `kid`
  after that. After every assertion under the old key has expired (at least 5 minutes), set `notAfter` on the old key.
- Compromise: set `notAfter` on the key to the current time. This stops new assertions under that key. It does not revoke
  links already created; review the links made in the exposure window.
- Wiring the key configuration into the running control API is **not done** (LINKING.md, "Scope and what is not
  implemented").

### Link commands

`link`, `link_relink` and `link_revoke` are the only write path, through the operator route `POST /v1/admin/provision`.
A product does not call that route. Ambiguous cases are recorded for review and fail closed (LINKING.md, "Ambiguous cases").
Review resolution is not built.

## 7. Feature flags and outbox events

- **Feature flags:** see [`docs/CONFIG.md`](CONFIG.md). Implemented and not deployed. No product reads a flag yet, and no
  flag is declared yet. A product uses a compiled-in default, must not cache a `fallback` response, and may cache other
  200 responses for at most 60 seconds.
- **Outbox events:** see [`docs/EVENTS.md`](EVENTS.md). The mechanism exists, but no business event is approved. The
  production event registry is empty. Do not build a consumer for an event that is not in the registry.

## 8. Status summary

| Area | Status on `main` | Source |
| --- | --- | --- |
| Identity, organisation and membership tables | Implemented in the database. Product use is not implemented. | Section 1 |
| Product registry and per-product contracts | Registry partial, validated at startup. Contracts are **DRAFT** (`0.1.0-draft`) and unverified. Tenant keys are assumptions. | PRODUCT_REGISTRY.md |
| `GET /v1/access/check` | Implemented and mounted. | section 5 |
| Service configuration read | Implemented. Off unless configured. No product reads it. | CONFIG.md |
| LMS decision endpoint | Implemented as opt-in (Pass 18 contract). | SKILLED-SERVICE-DECISION-CONTRACT-PASS18.md |
| Account linking | Central verifier implemented. **Product signing not implemented.** Key wiring not done. Review resolution not built. | LINKING.md |
| Sign-in | Central helper modules implemented, not mounted into products. Products must implement their own callback and session. | PASS13, PASS14 |
| App-local logout | Module implemented. Not claimed as global. | PASS13 |
| Global logout | Routes mounted behind a gate (off). Needs Logto URI registration and an app session loader. | PASS14, PASS15, #6 |
| Support console | Read API implemented, not mounted by default. | SUPPORT_CONSOLE.md |
| Launcher endpoints | **Not present on `main`.** | section 5 |
| Outbox events | Mechanism implemented. No events approved. | EVENTS.md |
| Subscriptions and billing | No provider connected and no webhook route. | SUBSCRIPTIONS.md |
| Logto deployment | **Not done** in this repository. Tracked under issue #24. Requires a supported PostgreSQL. | UPSTREAM.md |
