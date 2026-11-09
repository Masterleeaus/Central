# Titan Central: reverse-proxy rate limits (issue #5)

The app has an in-process limiter (`apps/control-api/src/rate-limit.mjs`). It is per process and resets on
restart, so production limits must also be enforced at the public reverse proxy on the DirectAdmin host.

Status: the templates here are written and structurally validated. They have NOT been applied to a live host
and were NOT run against a real nginx or Apache from this repository. Issue #5 is not closed by this directory alone.

## 1. Choose the proxy

Find out what answers on port 80/443 for the Central host before choosing:

    ss -ltnp | grep -E ':(80|443)\b'
    systemctl is-active httpd nginx

- If **nginx** is in front (DirectAdmin "nginx as reverse proxy" mode), use `nginx/zones.conf` and `nginx/locations.conf`.
  nginx `limit_req` is the best-understood option here.
- If **Apache** is the only front, use `apache/titan-central-vhost.conf`. It needs **mod_qos**, which is third-party
  and is not in a stock Apache build. Its directive semantics and the status it returns on rejection were **not
  verified** in this repository. Use it only after the burst test in section 4 shows 429. If it returns anything
  else, switch to nginx rather than accepting it.

## 2. Apply it via DirectAdmin's custom httpd configuration

DirectAdmin regenerates vhost files, so the template must go into a custom block and not into the generated file.
Menu names differ between DirectAdmin versions. Check yours before changing anything.

1. Replace the placeholders:
   - `__CENTRAL_PORT__` with the value of `TITAN_CENTRAL_PORT` (the app listens on `127.0.0.1` only).
   - Apache only: `__ACCESS_CONCURRENT_LIMIT__` and `__CALLBACK_CONCURRENT_LIMIT__` with operator-chosen integers.
   - nginx only: `zones.conf` goes in http{} context; `locations.conf` goes in the Central server{} block.
2. Run the validator on the templates as they are in the repository (placeholders included):

       python3 -I deploy/proxy/validate_templates.py

3. In DirectAdmin, open **Custom HTTPD Configurations** (admin level, or the domain's custom httpd page on
   your version), select the Central domain, and paste the Apache include (or the nginx server-block snippet).
   For nginx zones, use the http-level custom include point your DirectAdmin version provides.
4. Ensure mod_qos is loaded in the **global** configuration (`LoadModule qos_module ...`), not in the custom block.
5. Syntax check, then reload only if it passes:

       apachectl -t            # Apache
       nginx -t                # nginx

6. Reload the web server through DirectAdmin or the service manager.

## 3. Forwarding headers (required rule)

- The proxy MUST overwrite `X-Forwarded-For` (and `Forwarded`, `X-Real-IP`) from the real socket address.
  The templates do this: `RequestHeader unset` plus `ProxyAddHeaders On` (Apache), and
  `proxy_set_header X-Forwarded-For $remote_addr` with `Forwarded ""` (nginx).
- The proxy MUST NOT pass a client-supplied forwarding header to the app.
- The app derives `clientIp` from `req.socket.remoteAddress` only. `server.mjs` does not pass a custom `clientIp`, and no
  code in `apps/control-api` reads `X-Forwarded-For`. Because the API listens on loopback, every proxied request
  arrives from `127.0.0.1`. That means the app's per-IP limit (600/min by default) is effectively a limit on ALL
  traffic together. The proxy's per-IP limit is the only per-client limit. Do not change `clientIp` to read a header
  without a separate trust review. This is recorded in the app test `test/proxy-client-ip.test.mjs`.

## 4. Verify after applying

Run these from the host itself (loopback), and from an external client where noted.

Routing and admin denial:

    curl -sS -o /dev/null -w '%{http_code}\n' https://__CENTRAL_HOST__/v1/admin/provision   # expect 404
    curl -sS -o /dev/null -w '%{http_code}\n' https://__CENTRAL_HOST__/v1/access/check      # expect 401 (no token), not 404
    curl -sS -o /dev/null -w '%{http_code}\n' https://__CENTRAL_HOST__/healthz               # expect 200 if exposed

Forwarding header overwrite (the app's response should not depend on the client header):

    curl -sS -H 'X-Forwarded-For: 198.51.100.7' -o /dev/null -w '%{http_code}\n' https://__CENTRAL_HOST__/v1/access/check   # still 401, same bucket

Loopback check (the API must not be reachable directly):

    curl -sS -m 3 http://__CENTRAL_HOST_PUBLIC_IP__:__CENTRAL_PORT__/healthz   # expect connection refused or timeout

Burst test (from one external client), expecting 429 once the limit is exceeded:

    for i in $(seq 1 100); do curl -sS -o /dev/null -w '%{http_code}\n' https://__CENTRAL_HOST__/v1/access/check; done | sort | uniq -c

Expect a mix of 401 and 429 on `/v1/access/check`, and a `Retry-After` header on 429 for the app's own limiter.
If every response is 401 with no 429 under a burst, the proxy limit is not active. If the status is 503 instead of 429,
the Apache mod_qos status is not the one required: switch to nginx.

Callback burst: repeat the same loop against `/auth/titan/field/callback?state=x&code=y` and expect 429 after the
callback limit (the first requests return 400 `invalid_callback`, which is expected).

## 5. Not covered here

- Logto-side limits and the JWKS refresh guard are outside this directory.
- Per-subject limits are in the app (`subjectLimiter`), not at the proxy.
- Limits are per proxy instance. A second proxy node needs its own limits, or a shared store.

## Expanded attack-surface coverage (rate-hardening pass)

The reference nginx template now applies request-rate and concurrent-connection
limits to product OIDC **starts** as well as callbacks, the first-party
`/auth/central/start` and `/auth/central/callback` routes, and
`POST /auth/central/select`. Company-selection POST bodies have a 4 KiB proxy
cap, matching the application parser's bounded body. Each zone is keyed to
`$binary_remote_addr`, not an untrusted forwarded header.

The app also has an in-process `createConcurrencyLimiter` for expensive
access verification, browser OIDC work and company-selection requests. It
uses a finite global cap and a per-socket cap, releases permits on errors,
and rejects new keys when key cardinality is full instead of evicting
active clients. These app-side keys are normally the proxy loopback
address, so **do not treat them as independent client-IP protection**.

Operational acceptance still requires verifying the actual reverse-proxy
configuration, then testing short bursts on all routes, including
`/auth/central/select`, through the public endpoint. Never claim this
issue fully deployed from template-only tests. If Apache lacks mod_qos
or fails to return 429 as expected, use tested nginx limits.

## Product-host company-choice endpoints

The Central vhost intentionally does **not** forward local product
sessions. The separate reference templates
`nginx/product-selection.conf.template` and
`apache/product-selection.conf.template` are for each destination
product vhost only. They cap requests and concurrent sessions on
`/auth/titan/(field|desk|academy)/select`, enforce a 4-KiB POST
body limit under nginx, replace untrusted forwarding headers, and
proxy only to that product's loopback port.

The included `validate_product_selection.py` rejects accidental
loss of limits, missing product routes, wildcard Apache proxying,
header spoofing and non-loopback product targets. CI additionally
renders the nginx product include into an isolated container and runs
`nginx -t`. These are *template* checks, not proof that a customer
product host is configured correctly. Before launch, verify
mod_qos or nginx rate/concurrency behaviour and perform local-only
saturation and account-isolation tests against each real product.
