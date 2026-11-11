# Launcher OIDC application and session exchange (issue #72)

Status: code side only. The launcher stays signed out until the owner creates the Logto application and the
Central session loader is wired. Nothing in this repository creates a Logto application.

## Components in this repository

| Piece | Location | State |
|---|---|---|
| Launcher session resolver (calls Central, forwards only the browser Cookie header) | `apps/launcher/src/session-exchange.mjs` | Built, tested with fakes. Used only when `sessionExchange: true` in the launcher config. Default `false`. |
| Launcher config switch | `apps/launcher/src/config.mjs`, `config/launcher.json` | `sessionExchange` defaults to `false`. |
| Central exchange route `GET /v1/launcher/session` | `apps/control-api/src/launcher-session-exchange.mjs`, mounted in `app.mjs` | Built, tested. Not passed in `server.mjs`, so it answers 404 in production. |
| Central session loader (browser cookie to organisation and token) | not built | Owner decision required (see below). |
| Launcher sign-in application in control-api (`/auth/titan/launcher/start`) | not built | Needs a fourth application in `packages/control-plane` `ApplicationId`, the Logto plan, and the session cookie policy. |

## Owner steps (Logto)

1. Create a **confidential** Traditional web application for the launcher, the same client type as the Field, Desk and
   Academy applications (`docs/UPSTREAM.md`). The client secret is entered on the server only and is never placed in the
   repository, a ZIP, or chat.
2. Redirect URI (exact match): `<centralOrigin>/auth/titan/launcher/callback`. The callback is served by Central, using the
   shared `oidcCallbackPath` shape in `packages/control-plane/src/applications.ts`.
3. Post-logout redirect URI: the launcher's public origin. **Open:** the launcher origin is not in the launcher config yet.
   The owner confirms the origin, and it is added to the Logto application and the config together.
4. Scopes: `openid profile email`, the same as the other applications. Confirm whether the organisation scope is needed for
   the Logto organisation claims before the first live sign-in. This is not decided here.
5. Record the application ID and its audience. The audience must be distinct from the Field, Desk and Academy audiences
   (ADR-005) before it is added to the token verifiers.

## Open decisions (block enabling the exchange)

- **Who may call `/v1/launcher/session`.** The route returns the bearer token. It must be reachable only by the
  launcher server. Before the route is enabled, choose one: loopback-only with a host firewall, or a shared secret the
  launcher presents. The reverse proxy must never publish `/v1/launcher/`. Add that prefix to the proxy deny list
  (`deploy/proxy`, issue #74) before enabling the route.
- **Which token the exchange returns.** Verifying the token in `/v1/access/check` needs an audience that Central accepts.
  Today the verifier accepts only the three application audiences. A launcher audience means a new environment variable
  (for example `TITAN_LAUNCHER_AUDIENCE`), its entry in `deploy/env.example` and its row in the variable table, and an
  additional verifier. This is a security decision, not a code default.
- **The session loader.** The loader reads the launcher's own sign-in session. That needs the launcher sign-in route and
  cookie, which depend on the two decisions above.

## Enabling order

1. Owner creates the Logto application (steps above) and records its ID and audience.
2. Decide the two open decisions and add the proxy deny for `/v1/launcher/`.
3. Add the launcher application to control-api and the session loader, with tests against fakes and a real Logto staging
   run.
4. Set `sessionExchange: true` in the launcher config on the host and restart the launcher.
5. Confirm the launcher lists the signed-in organisation's products, using the owner's staging account.

Until step 3 is complete, `sessionExchange` stays `false` and the launcher shows the signed-out page.
