# Central — Skilled service authorization contract (Pass 18)

This change introduces an **opt-in** POST `/v1/integrations/academy/decision` API. It remains unmounted when `TITAN_SKILLED_DECISION_BEARER` is absent. If configured, the server requires an independent, server-managed secret (minimum 32 characters), and validates a strict body with `applicationId=academy`, the server's exact OIDC issuer, an OIDC-verified subject asserted by the trusted Skilled service, a random correlation requestId and a **Central internal UUID organisationId** resolved from an operator-provisioned registry. Neither email, browser-selected role, company, token claims nor dynamic provider URLs are accepted.

The handler delegates to existing `CentralAccessService` inside `withCentralReadSnapshot`, which sets transaction-local `titan_trusted_reader` role and RLS organisation scope, and checks active Central identity, organisation, membership, entitlement (including `session:open`) and verified local account link. It returns the trusted Logto organisation ID, Skilled user/account IDs and current membership, entitlement and link revisions.

### Request shape
```json
{"applicationId":"academy","issuer":"https://logto.example","subject":"logto-subject","organisationId":"00000000-0000-4000-8000-000000000001","requestId":"a-correlation-nonce-at-least-32-characters"}
```

### Response (200 only when authorized)
```json
{"issuer":"https://logto.example","subject":"logto-subject","requestId":"same-request-id","decision":{"allowed":true,"applicationId":"academy","organisationId":"trusted-logto-organisation-id","localUserId":"trusted-user-id","localAccountId":"trusted-account-id","membershipRevision":1,"entitlementRevision":2,"linkRevision":3}}
```

Bad credentials are 401; unsupported input is 400; denied access is 403; database or Central engine outage is 503. HTTP responses never contain a service secret, subject-derived diagnostic or internal reason. Existing `/v1/access/check` contract is unchanged. No public admin mutation is exposed. Mandatory service proxy controls: HTTPS, IP allowlisting, operator-managed secret rotation, per-service rate limits and request logging without credentials.

### Still required
- The trusted Skilled caller must resolve the Central internal organisation UUID from an **operator-controlled** association to the verified Central Logto org ID; never from a raw browser selection.
- OIDC sign-in is not automatically enabled. Product account mapping, live service credentials and full two-tenant integration require deployment rehearsal.
- This endpoint is an opt-in service credential path and is **not** a substitute for end-user Logto JWT verification. Protect the secret like a privileged service credential.

Central #27–29 and Skilled #71 remain open until live verification.

## Skilled alignment (issue #70)

Checked against Skilled `lms-main/apps/backend/src/modules/auth/central-decision-transport.ts` and its fixture `central-decision-transport.fixture.ts` at Skilled commit 95935bb (committed HEAD; the working tree had uncommitted edits, which were not used). The Central contract above is the source of truth. Skilled's client must change to match it. Skilled was not edited in this change.

Matches (verified by `apps/control-api/test/service-decision-skilled-contract.test.mjs`):
- Response envelope keys `issuer`, `subject`, `requestId`, `decision`, and decision keys `allowed`, `applicationId`, `organisationId`, `localUserId`, `localAccountId`, `membershipRevision`, `entitlementRevision`, `linkRevision`. Both sides require exact key sets.
- `allowed` is `true` and `applicationId` is `academy`.
- Identifiers match `[A-Za-z0-9:_-]{1,200}`, and revisions are non-negative safe integers. Skilled's fixture values pass.
- `requestId` is echoed unchanged and must match `[A-Za-z0-9_-]{32,128}`.
- Response is `200` with `application/json`. Skilled accepts only that media type.
- `401`, `400`, `403` and `503` all lead Skilled to return no decision (fail closed).

Mismatches to resolve on the Skilled side (owner decision recorded here):
1. **organisationId is required by Central and missing from Skilled's request.** Central rejects any body without `organisationId` (a Central internal UUID), with `400`. Skilled sends only `applicationId`, `issuer`, `subject` and `requestId`. Skilled must add an operator-controlled mapping from the Central internal organisation UUID to the verified Logto organisation ID. It must never come from browser input. The test `gap: Skilled current request body...` pins the current refusal and should be inverted when Skilled sends the field.
2. **Endpoint path.** Central serves only `/v1/integrations/academy/decision`. Skilled's fixture endpoint is `https://central.example.test/internal/academy/access-decision`. Skilled's configured endpoint must use the Central path.
3. **Bearer token charset.** Central accepts only `[A-Za-z0-9_.-]{32,1024}` in `Authorization: Bearer`, and `TITAN_SKILLED_DECISION_BEARER` must match the same pattern. Skilled's client accepts any string of 32 to 1024 characters without CR or LF, so a token containing other characters would pass Skilled and fail Central with `401`. Skilled must generate or validate its credential with this charset.

Tests: Central side is covered in this repository. Skilled's own tests still assume the current client body and endpoint, so they must be updated in Skilled. Live credentials are not needed for these tests.
