# Account linking contract (issue #37)

Status: contract and Central-side verifier implemented. **The product side is not implemented in this repository.** Sorted, Supercharged and LMS must add the signing described below before any link can be created in production.

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
- Wiring the key configuration into a running service is not done here. The operator route answers `503 provisioning_disabled` in the default configuration (`apps/control-api/src/operator-config.mjs`).

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

Migration 0014 adds a unique index on `(application_id, local_account_id)` where `state = 'verified'`. A local account is verified for at most one identity and organisation per application. Review rows are open. This build has no command that resolves them; resolution is a reviewed operator action yet to be designed.

## Audit

`titan.provisioning_audit` stores the request ID, actor, authority reference, command kind, subject ID and a digest. For link commands the digest holds the SHA-256 of the assertion, never the token itself.

## Scope and what is not implemented

- **Product side (not implemented here):** Sorted, Supercharged and LMS must hold the Ed25519 private key, issue opaque immutable local IDs, sign the assertion for each link, and never sign display names or emails.
- Operator wiring of key configuration into the running control API.
- Review resolution commands and UI.
- Migrations 0010 to 0013 are not present on this branch; 0014 is applied after 0009.
- Tests: `packages/control-plane/test/link-assertion.test.mjs` (rejection rules, replay, rotation, key validation), `link-lifecycle.test.mjs` (create, review, relink, unlink, digests), `link-trusted-flow.test.mjs` (verifier behind the trusted service, cross-tenant, cross-product, email-only), and `apps/control-api/test/session-revocation-provisioning.test.mjs` (unlink revokes one application's session). The SQL was run against PostgreSQL 16 with migrations 0001 to 0009 and 0014.
