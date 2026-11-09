# Signed service JWT to real PostgreSQL end-to-end verification

The configuration workflow installs Central's pinned pg dependency only in
disposable CI, loads isolated service-grant and company scoped-flag fixtures,
and exercises createPgAuthenticatedConfigHandler with a locally signed RS256
token and a fixture JWKS response. A restricted grant read resolves the
canonical company, then a separate restricted configuration transaction
retrieves a company-specific revision through PostgreSQL row-level security.

Tests prove that two distinct verified machines read different company
values, revoked/expired/missing service grants are denied, mismatched audience
is rejected, and forged company headers or query parameters are denied.
Never include fixture signing keys or deployment credentials in source.

This verifies the application query pipeline in disposable PostgreSQL 16.
It does not constitute production Logto integration, company migration
ownership, independent DB login provisioning, or deployment readiness.
