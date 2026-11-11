# Configuration-engine live enablement gates

A production deployment must use independently provisioned, non-superuser
database login credentials with only necessary SET ROLE membership, a
canonical migration chain owned by #43, live Logto issuer discovery/JWKS,
revocation/rotation policy, authoritative grant provisioning, audit review,
and reverse-proxy rate limiting. The opt-in HTTP config endpoint remains
off by default; never enable it using the CI fixture DB user.

The new end-to-end test uses a superuser solely to create disposable
fixtures and switch into restricted NOLOGIN roles. That setup does not
prove an unprivileged production login's SET ROLE rights or prevent an
arbitrary SQL client from setting tenant GUCs; production must expose only
the server-owned authenticated query API.
