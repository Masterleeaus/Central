# Pass 07 — Machine-to-machine Logto credential adapter

## Implemented in this release

A server-only OAuth2 client-credentials client now supplies tokens to the Pass 06 `LogtoManagementVerifier` through `createLogtoManagementTokenSupplier`. It uses the fixed `/oidc/token` endpoint with `client_secret_basic`, `grant_type=client_credentials`, configured resource and scope, explicit HTTPS issuer validation, 5-second timeout, blocked redirects, bounded token validity, refresh caching and concurrent refresh de-duplication. No credentials or received tokens appear in error text. Requests never source client credentials, resource or token origin from user input.

The adapter matches the implementation of the Logto v1.45.0 source at `packages/core/src/libraries/cloud-connection.ts` (machine token request). It is intentionally separate from upstream Logto code.

## Integration example (trusted backend only)

```ts
import {createLogtoManagementTokenSupplier,LogtoManagementVerifier} from '@titan-central/control-plane';
const tokenSupplier=createLogtoManagementTokenSupplier({
  issuerOrigin: process.env.LOGTO_ISSUER_ORIGIN!,
  clientId: process.env.LOGTO_M2M_CLIENT_ID!,
  clientSecret: process.env.LOGTO_M2M_CLIENT_SECRET!,
  resource: process.env.LOGTO_MANAGEMENT_API_RESOURCE!,
  scope: process.env.LOGTO_MANAGEMENT_SCOPE!,
});
const verifier=new LogtoManagementVerifier({
  origin: tokenSupplier.origin,
  accessToken: tokenSupplier.accessToken,
});
```

Never put credentials in Git, HTTP responses, logs or browser bundles. Create a machine-to-machine Logto application with narrowly scoped Management API access and store its credentials in a protected server-side secret store. Avoid the broad `all` scope in production if narrower documented scopes cover the necessary operations.

## NOT completed / deployment gate

- No live Logto service, token endpoint or Management API was contacted; all token tests use deterministic mocks.
- No real M2M app registration or OIDC Desk/Field/Academy client registrations.
- No real PostgreSQL Central migration or SSO redirects/callback handlers deployed.
- Provisioning's `authorize` callback still requires a separately implemented role/delegation policy and database-backed canonical identity resolution.
- Session/logout/revocation tests across the three live applications remain required.
- Logto 1.45 may need a separate newer PostgreSQL installation; do not upgrade the existing PostgreSQL 13 server without a tested migration/rollback.

## Next

Verify a real Logto service, least-privilege M2M registration, Management API permission scopes and role delegation; then add a safe administrative API behind verified OIDC authentication and test actual organisations using a dedicated `titan_central` database. Keep upstream Logto source unchanged.
