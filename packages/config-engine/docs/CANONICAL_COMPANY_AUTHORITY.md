# Canonical company grant authorisation (Issue #43 dependency)

The server-only canonical grant service requires a separately verified Logto
operator principal, a fresh operator role check, an active company, current
owner/admin membership and active product entitlement. The SQL check joins
canonical company, identity, membership and entitlement records; parameter
binding prevents SQL injection. Expired memberships and entitlements deny.

The CI-only fixture models unmerged PR #46. It is NOT a production migration.
The dedicated NOLOGIN reader has only SELECT access to columns needed
for authorisation. Grant lifecycle verification uses a real restricted
PostgreSQL writer followed by a grant-reader check and immutable audit check.

Do not deploy before the single migration chain under Issue #43 is approved,
company-role policies receive a security review, and separate limited login
credentials are provisioned. No public grant-management route is created.
