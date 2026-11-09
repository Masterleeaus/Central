# Account linking contract (issue #37)

Status: contract, Central-side verifier, key configuration and operator review resolution implemented. **The product side is not implemented in this repository.** Sorted, Supercharged and LMS must add the signing described below before any link can be created in production.

## Purpose

A Central identity may act in a connected product only through a local account that the product itself has proven it controls. Central records that proof as a link for one (identity, organisation, application) triple. Email addresses and display names are never proof and never select a link.

## Terms

| Term | Meaning | Where Central stores it |
| --- | --- | --- |
| Central identity subject | The Logto subject of the user (`usr_...`) | `titan.identities.logto_subject` |
| Organisation identifier | The Logto organisation ID | `titan.organisations.logto_organisation_id` |
| Product | `sorted`, `supercharged`, `lms` (`PRODUCT_IDS`) | key sets in operator config |
| Application | Legacy id `field`, `desk`, `academy` (`LEGACY_TO_PRODUCT`: field to sorted, desk to supercharged, academy to lms) | `titan.local_account_links.application_id` |
| Local account | `local_user_id` and `local_account_id`, opaque and immutable IDs issued by the product | `titan.local_account_links` |

## The assertion

The product signs a short-lived compact JWS:

- Header: `alg` = `EdDSA` (Ed25519), `typ` = `titan-link+jwt`, `kid` = the key ID. No other header fields.
- Signature: Ed25519 over the ASCII bytes of `header.payload`. The signing key is the product's private key, which Central never holds.

Claims:

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

Example claims (illustrative values, not a valid signed token):

```json
{ "iss": "sorted", "aud": "titan-central", "sub": "usr_7f3k2m9a", "org": "org_4hq8c1zd",
  "lu": "sorted-user-1842", "la": "sorted-acct-2291", "nonce": "q2Xv...base64url...", "iat": 1794240000, "exp": 1794240120 }
```

## Verification order (`LinkAssertionVerifier.verify`)

1. Application maps to a product (`unknown_product` otherwise).
2. Token is three base64url segments, at most 4096 characters (`malformed`).
3. Header `alg` is `EdDSA` and `typ` is `titan-link+jwt` (`bad_algorithm`). Unknown header fields are `malformed`.
4. No forbidden claims (`forbidden_claim`).
5. `iss` is a known product with a key set (`unknown_product`), and equals the application's product (`product_mismatch`).
6. `aud` is `titan-central` (`wrong_audience`).
7. `kid` exists in that product's key set (`unknown_key`), and the key is inside its validity window (`key_inactive`).
8. Signature verifies with that key (`bad_signature`). Nothing in the claims is trusted before this step.
9. Required claims present (`missing_claim`); lifetime valid (`bad_lifetime`); not future-dated (`future_dated`); not expired (`expired`); identifiers opaque (`identifier_not_permitted`); nonce well-formed (`malformed`).
10. `sub`, `org`, `lu` and `la` equal Central's records and the command (`subject_mismatch`, `organisation_mismatch`, `account_mismatch`).
11. Nonce consumed (`replayed`). This is last, so a rejected assertion never spends its nonce.

Rejections throw `LinkAssertionRejected` with one of these fixed codes. No code reveals a key, a claim value or a stored record.

## Keys and rotation

Operator-controlled configuration, one key set per product:

```json
[
  { "productId": "sorted", "keys": [
      { "kid": "sorted-2026-01", "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "<public key, base64url>" },
        "notBefore": "2026-01-01T00:00:00.000Z", "notAfter": "2026-11-10T00:00:00.000Z" },
      { "kid": "sorted-2026-11", "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "<public key, base64url>" },
        "notBefore": "2026-11-01T00:00:00.000Z" } ] }
]
```

- Public keys only. A JWK with `d` or any member other than `kty`, `crv` and `x` is refused at construction, as is any non-Ed25519 key, duplicate product sets, duplicate `kid` values, or more than 8 keys per product.
- Keys come from operator configuration. They are never read from a request, a product or a token header.
- Rotation: publish the new key with `notBefore` no later than the first assertion signed with it. Products switch `kid` after that. After every assertion under the old key has expired (at least 5 minutes), set `notAfter` on the old key.
- Compromise: set `notAfter` on the key to the current time. This stops new assertions under that key. It does not revoke links already created; review the links made in the exposure window.
- Keys are loaded at startup from operator configuration. See "Operator configuration" below.

## Operator configuration (names only)

- `TITAN_LINK_KEYS_FILE` names a JSON file holding the key sets. `TITAN_LINK_KEYS_JSON` holds the same JSON inline. Set at most one.
- Read once at startup. Malformed configuration fails startup, whether or not the operator plane is on. Unset means no key sets.
- Every key must declare `"alg": "EdDSA"`.
- Rules, each tested in `apps/control-api/test/link-key-config.test.mjs`: exactly one source; the file can be read; valid JSON; one to three entries, each a known product (`sorted`, `supercharged`, `lms`) listed once; 1 to 8 keys per product; only the documented fields, so no private member (`d` and the like); `kid` of 1 to 64 letters, digits, dots, underscores or hyphens, unique within its product; `alg` `EdDSA`; `kty` `OKP` and `crv` `Ed25519`; `x` a 32-byte base64url public key; `notBefore` an RFC 3339 time with an offset; `notAfter` optional, RFC 3339, and later than `notBefore`.
- Errors name the variable and the rule. They never echo a value or a file path.
- `POST /v1/admin/provision` runs trusted provisioning only when the operator plane (`TITAN_OPERATOR_*`) is on and key sets are configured. Otherwise it answers `404` (operator plane off) or `503 provisioning_disabled` (no key sets).

## Nonce store and replay

`titan.link_assertion_nonces` (migration 0014) holds `(product_id, nonce, expires_at)`. Consumption runs in its own transaction as `titan_trusted_writer`: it prunes rows whose `expires_at` has passed, then inserts with `ON CONFLICT DO NOTHING`. Because an assertion is refused after `exp` in any case, a nonce only needs remembering until then. The table therefore stays bounded by the assertion lifetime.

If the link write that follows is refused, the nonce stays spent, and the product signs a new assertion. Retrying an already applied link also reports `replayed`, not the original result.

## Commands (the only write path)

All writes go through `CentralProvisioner` (`packages/control-plane/src/provisioning.ts`), called by `TrustedProvisioningService`. That service requires a verified operator actor, checks the authorisation policy, resolves Central's identity and organisation, asserts live Logto membership, and verifies the assertion. The operator route `POST /v1/admin/provision` accepts these account-link commands:

| Command | Effect | Requires |
| --- | --- | --- |
| `link` | Creates a verified link. `verified_at` is database time; the caller supplies no time. | `assertion` |
| `link_relink` | Moves an existing link (verified or revoked) to a different local account. Bumps the subject's sessions for that application and organisation. | `assertion`, `expectedRevision`, matching identity and application |
| `link_revoke` (unlink) | Sets the link to `revoked`. Bumps `titan.titan_session_revocations` for (application, subject, organisation) in the same transaction. No other application is affected. | `expectedRevision` |
| `link_review_resolve` | Resolves an open review as `approved` or `rejected`. See "Resolving a review". | `decision`, `reason`; when approved: `assertion`, `localUserId`, `localAccountId`, and `expectedRevision` when a link exists |

Every command runs in one transaction with one audit row. Locks are taken with `FOR UPDATE`, and the revision is compared before any change. A stale revision fails with `revision conflict` and changes nothing.

Relink to the account already linked is refused as a no-op.

## Ambiguous cases: fail closed and record for review

| Situation | Outcome | Recorded |
| --- | --- | --- |
| Identity already has a verified link in this organisation and application, for another account | `LinkReviewRequired` `existing_link_other_account` | `titan.link_reviews` row and audit row, committed. The link is unchanged. |
| The local account is verified for another identity or organisation | `LinkReviewRequired` `account_claimed_elsewhere` | Same |
| A concurrent transaction wins the unique-index race | `LinkReviewRequired` `concurrent_conflict` | Same |
| Identity has a revoked link in this tuple on create | Plain conflict: use relink | Nothing |
| Stale `expectedRevision` | `revision conflict` | Nothing |

Migration 0014 adds a unique index on `(application_id, local_account_id)` where `state = 'verified'`. A local account is verified for at most one identity and organisation per application. Review rows are open until an operator resolves them with `link_review_resolve` (see "Resolving a review"). Nothing is resolved automatically.

## Resolving a review

An operator resolves a `titan.link_reviews` row with the `link_review_resolve` command, on the same route and through the same `TrustedProvisioningService` and `CentralProvisioner` as every other write. There is no second write path.

| Field | Meaning |
| --- | --- |
| `id` | The review ID |
| `identityId`, `organisationId`, `applicationId` | Must match the review row, or the command is refused |
| `decision` | `approved` or `rejected` |
| `reason` | 1 to 500 characters, no surrounding space, no control characters. Stored on the review and in the audit row |
| `localUserId`, `localAccountId`, `assertion` | Approval only. The assertion is verified exactly as for a link. `localAccountId` must equal the review's account |
| `expectedRevision` | Approval, when the identity already has a link for this application. Must equal that link's current revision |

Outcomes:

- `approved` with no link for the identity and application creates it (`created`). With a link it relinks that row (`updated`), revokes that application's sessions for the subject, and needs a matching `expectedRevision`.
- `rejected` records the decision only. It creates nothing and needs neither an assertion nor live Logto membership, so it can still close a review after the operator's own membership has changed.
- An identical retry of an applied request is `replayed`. That check runs before the assertion is verified, so the spent nonce is not consumed again. A new request for an already resolved review with the same decision is also `replayed`. It is audited under its own request ID, and the first resolver stays on the review.
- A resolved review never changes. A different decision or a different local account is refused. A database trigger refuses any update to a resolved row (migration 0018).
- Any failure (stale `expectedRevision`, account still verified elsewhere, concurrent write, cross-tenant scope) rolls the whole transaction back. The review stays open, nothing is audited, and the route answers `503 provisioning_unavailable`. A caller without operator authority gets `403` and nothing is read or written.

Each resolution writes one `provisioning_audit` row: request ID, reviewer (`actor_subject`), command kind `link_review_resolve`, `reason`, and the command digest, which holds the assertion hash only.

## Audit

`titan.provisioning_audit` stores the request ID, actor, authority reference, command kind, subject ID and a digest. For link commands the digest holds the SHA-256 of the assertion, never the token itself.

## Scope and what is not implemented

- **Product side (not implemented here):** Sorted, Supercharged and LMS must hold the Ed25519 private key, issue opaque immutable local IDs, sign the assertion for each link, and never sign display names or emails.
- Review UI and a review queue listing are not implemented. Reviews are resolved only through `link_review_resolve`.
- Migrations 0010 to 0013 are not present on this branch; 0014 is applied after 0009, and 0018 after 0014 (0015 is billing events on main).
- Tests: `packages/control-plane/test/link-assertion.test.mjs` (rejection rules, replay, rotation, key validation), `link-lifecycle.test.mjs` (create, review, relink, unlink, digests), `link-trusted-flow.test.mjs` (verifier behind the trusted service, cross-tenant, cross-product, email-only), and `apps/control-api/test/session-revocation-provisioning.test.mjs` (unlink revokes one application's session). The lifecycle SQL was run against PostgreSQL 16 with migrations 0001 to 0009, 0014 and 0015. Resolution was verified through the built provisioner with real Ed25519 assertions: 37 checks covering approval, relink, stale revision, idempotent retry, rejection, claimed accounts, cross-tenant and non-operator refusal, the resolved-row trigger and the column grants. The existing `tests/sql/rls_two_tenant.sql` passes on the same migrations. Tests for the new behaviour: `packages/control-plane/test/link-review-resolution.test.mjs`, `apps/control-api/test/link-key-config.test.mjs`, `apps/control-api/test/link-review-route.test.mjs`.
