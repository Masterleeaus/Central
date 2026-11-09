# Titan Central launcher

A minimal, server-rendered sign-in and product launcher for Titan Central (issue #44).

After sign-in it shows the active company, the three products (Sorted, Supercharged, LMS) with their
access status from Central's access check, and a company-switch link when one is configured.

- Plain Node `http` (>= 22). No runtime dependencies, no bundler, no framework.
- Sign-in is not implemented here. The launcher links to the existing control-api start route
  `/auth/titan/{app}/start`; the OIDC flow stays in control-api.
- Access is decided by Central. The launcher renders only what the server returned; a hidden link is not authorisation.

## Layout

```
config/launcher.json   product destinations, Central origin, sign-in and switch settings
src/config.mjs         config validation (fails closed, reports every problem)
src/access.mjs         server-side GET /v1/access/check per product
src/render.mjs         HTML generation with escaping
src/app.mjs            request handler (routes, headers, session handling)
src/server.mjs         entry point and createLauncherServer()
public/launcher.css    responsive styles, light and dark tokens
scripts/build.mjs      validates config and copies runtime files to dist/launcher
test/                  node:test suites (see Tests)
```

## Routes

| Method and path | Purpose |
| --- | --- |
| `GET /` | Signed-out page with a sign-in link, or the launcher page for a signed-in session |
| `GET /assets/launcher.css` | Stylesheet |
| `GET /healthz` | Liveness, no Central call |

Anything else returns 404. Non-GET methods return 405. The handler never reads organisation or product
choices from the query string: the organisation comes only from the server-side session, and each product's
application and action come only from config.

## Configuration

`config/launcher.json` (override the path with `LAUNCHER_CONFIG`). Validation rules:

- `centralOrigin`: https origin, no path, query or credentials. Plain http is accepted only for localhost and 127.0.0.1.
- `signIn.applicationId`: `null` (sign-in disabled, shown as a clear state) or one of `field`, `desk`, `academy`, the applications that have a control-api start route.
- `organisationSwitch`: `null`, or `{ "url": "https://..." }` pointing at the organisation-selection flow.
- `timeoutMs`: 100 to 30000, used for each Central call.
- `products`: exactly `sorted`, `supercharged`, `lms`, each mapped to its legacy application (`field`, `desk`, `academy`) as in the #29 registry. Each needs an https `url`.

Destinations are only ever read from this file. Stage names are not hard-coded in the source.

## Local development

Requires Node 22 or later. There are no dependencies to install.

```sh
cd apps/launcher
npm test          # node --test test/*.test.mjs
npm start         # http://127.0.0.1:3100 (PORT and HOST override)
npm run build     # validate config, copy runtime files to dist/launcher (git-ignored)
```

The running server currently uses a session resolver that always returns "signed out". See
"Known gaps" below. To exercise the signed-in page locally, the tests inject a session through
`createLauncherServer({ config, resolveSession, fetchImpl })`.

## Tests

- `config.test.mjs`: config validation (URLs, mapping, sign-in, switch, bounds).
- `access.test.mjs`: the Central call (organisation, application, action, bearer header, redirect refused, timeout) and fail-closed status mapping.
- `routes.test.mjs`: routes, signed-out and signed-in states, expired sessions, client-supplied parameters ignored, escaping, headers, company switch. Central is mocked with an injected `fetchImpl`.
- `a11y-structure.test.mjs`: structural checks on the rendered HTML (language, viewport, one h1, heading order, labelled sections, link text, no positive tabindex, no inline handlers, state conveyed in text). Not a WCAG audit.
- `smoke.playwright.test.mjs`: headless Chromium at 390 px (deviceScaleFactor 2), keyboard reachability of the allowed product link, no horizontal scroll at 390 px and 320 px, and a screenshot. Uses `require('playwright')` if available and skips otherwise. It does not install browsers. Set `LAUNCHER_SCREENSHOT_PATH` to choose the screenshot location.

## Known gaps (need control-api or product decisions)

1. **No launcher OIDC application.** `/auth/titan/{app}/start` exists only for `field`, `desk` and `academy`. Sign-in stays disabled until a launcher application is registered in control-api and the config names it.
2. **No session exchange.** The launcher needs the signed-in organisation and a bearer token for `/v1/access/check`. control-api has no endpoint that returns these to a separate app, so `src/server.mjs` uses a signed-out resolver.
3. **No organisation selection.** Organisation selection (#32) is future work per the PASS13 notes. The company switch is config-driven and shows "not available" until a route exists.
4. **Destinations and origins** come from the repository's existing `*.titanzero.io` fixtures. They must be confirmed against the deployed hosts.
