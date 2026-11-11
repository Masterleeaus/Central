# Central — Skilled service authorization contract (Pass 18)

This change introduces an **opt-in** POST `/v1/integrations/academy/decision` API. It remains unmounted when `TITAN_SKILLED_DECISION_BEARER` is absent. If configured, the server requires an independent, server-managed secret (minimum 32 characters), and validates a strict body with `applicationId=academy`, the server's exact OIDC issuer, an OIDC-verified subject asserted by the trusted Skilled service, a random correlation requestId and a **Central internal UUID organisationId** resolved from an operator-provisioned registry. Neither email, browser-selected role, company, token claims nor dynamic provider URLs are accepted.

The handler delegates to existing `CentralAccessService` inside `withCentralReadSnapshot`, which sets transaction-local `titan_trusted_reader` role and RLS organisation scope, and checks active Central identity, organisation, membership, entitlement (including `session:open`) and verified local account link. It returns the trusted Logto organisation ID, Skilled user/account IDs and current membership, entitlement and link revisions.

### Request shape
```json
{"applicationId":"academy","issuer":"https://logto.example","subject":"logto-subject","organisationId":"00000000-0000-4000-8000-000000000001","requestId":"a-correlation-nonce-at-least-32-characters"}
```

### Response (200 only when authorized)
```json
{"issuer":"https://logto.example","subject":"logto-subject","requestId":"same-request-id","decision":{"allowed":true,"applicationId":"academy","organisationId":"trusted-logto-organisation-id","localUserId":"trusted-user-id","localAccountId":"trusted-account-id","membershipRevision":1,"entitlementRevision":2,"linkRevision":3,"expiresAt":"2026-11-11T10:05:00.000Z"}}
```

**Expiry (owner decision):** every issued decision carries `expiresAt`, an RFC 3339 timestamp equal to the issue time plus exactly 300 seconds (5 minutes). A decision whose `expiresAt` has passed must not be treated as authorization; the consumer must request a new decision. `expiresAt` is set only on 200 responses. Denied (403) and unavailable (503) responses carry no decision.

Bad credentials are 401; unsupported input is 400; denied access is 403; database or Central engine outage is 503. HTTP responses never contain a service secret, subject-derived diagnostic or internal reason. Existing `/v1/access/check` contract is unchanged. No public admin mutation is exposed. Mandatory service proxy controls: HTTPS, IP allowlisting, operator-managed secret rotation, per-service rate limits and request logging without credentials.

### Still required
- The trusted Skilled caller must resolve the Central internal organisation UUID from an **operator-controlled** association to the verified Central Logto org ID; never from a raw browser selection.
- OIDC sign-in is not automatically enabled. Product account mapping, live service credentials and full two-tenant integration require deployment rehearsal.
- This endpoint is an opt-in service credential path and is **not** a substitute for end-user Logto JWT verification. Protect the secret like a privileged service credential.

Central #27–29 and Skilled #71 remain open until live verification.
