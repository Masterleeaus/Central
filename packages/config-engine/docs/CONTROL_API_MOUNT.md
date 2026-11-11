# Central config route — opt-in only

The Central API returns 404 for /v1/config/* unless a handler is configured.
The server mounts the handler only with TITAN_CONFIG_ENABLED=true,
a Logto issuer, explicit JWKS URI, separate M2M audience, rollout salt and
a server-injected configLookup callback. Missing dependencies fail startup.

The callback must read centrally authorised service-to-company grants. This
module does not provision the registry. Keep disabled until #43 shared
company FKs, restricted DB role provisioning, reverse-proxy rate limits
and integration validation have been completed.
