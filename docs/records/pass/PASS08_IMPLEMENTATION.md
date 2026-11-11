# Titan Central — Pass 08: organisation authority and OIDC registration plans

## Implemented

- `LogtoManagementVerifier.assertAnyOrganisationRole` checks fresh organisation membership and exact Logto organisation role IDs using the **actual source-defined** `GET /api/organizations/{id}/users/{userId}/roles` Management API route. The lookup has a bounded number of pages and fails closed on malformed responses, missing membership or removed roles.
- `createOrganisationProvisioningAuthorizer` supplies the required policy callback for the Pass 06 trusted provisioning service. It resolves the canonical organisation ID through a trusted server lookup, rejects caller-supplied identities and only authorises current administrators using an explicit role-ID allowlist. No automatic permission for canonical identity/organisation creation.
- `createTitanOidcRegistrationPlans` produces three reviewed OIDC client registration *plans* (Field, Desk, Academy) with HTTPS-only origins and exact callback/logout URIs. Authorization Code and PKCE S256 are requirements; no client is actually created.
- Unit tests cover authorised and unauthorised membership, removed roles, API failure, duplicate origins, URI tampering and invalid registration inputs.

## Scope, security and deployment gates

The policy callback only becomes trustworthy when `TrustedActor.logtoSubject` is assigned by a verified backend OIDC session, **never by JSON payload or an unverified bearer header**. The `managementCredentialVerified` field is a type contract, not a cryptographic check by itself. The privileged provisioning route and canonical lookups must be hosted inside a trusted application boundary and independently authorised. Do not expose direct `TrustedProvisioningService.apply()` to users.

Configured role IDs must reference real Logto org-role records verified in the deployed instance. Role names such as `owner` must not be treated as authority without role-ID mapping. An organisation admin cannot automatically create global identities or organisations. Add separately reviewed platform-operator authority for that capability.

The registration plans do not call the Management API and do not prove that `/auth/callback` works in any application. Register clients only after compatible callback/session handlers are built. Use authorization code + PKCE, issuer/audience/state/nonce verification and locally managed application sessions. Verify logout and account switching across all three apps.

## Verified locally

TypeScript compilation succeeds with the existing compiler. All control-plane tests, control-api tests and source preservation checks pass. No live Logto, database, or application service was contacted. No server configuration changed. Upstream Logto remains byte-for-byte unchanged.

## Next Pass 09

Wire a protected operator/admin API with independently verified actor sessions, restrict management credentials to the backend, implement real OIDC client registration against a staging Logto service, and run a three-app authorization-code flow in isolated staging. Don't deploy a production identity provider on PostgreSQL 13.
