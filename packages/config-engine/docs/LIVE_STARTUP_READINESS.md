# Live config readiness gates (Pass 22)

The opt-in config endpoint now requires independently authenticated database
connections using the intended restricted login identities: one config reader,
one service-grant reader. Runtime PostgreSQL catalog checks confirm each
login is non-superuser, does not bypass RLS or inherit privileges, has only
the needed read-role membership and lacks the other service's role membership.

Both login checks must succeed before the canonical company schema and
approved SHA-256 migration receipt checks execute. The migration approval
environment value only permits a check; it is not itself security evidence.
Startup failures trigger both config pool and operational pool cleanup.
The deployment remains disabled until review of Issue #43 and live Logto,
TLS, secrets, proxy limits, monitoring and access controls.
