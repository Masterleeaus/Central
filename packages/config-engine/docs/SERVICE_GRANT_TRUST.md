# Company and service grants

RSA-signed service JWT validation establishes service identity only.
A server-owned company registry must supply an active grant for the exact
requested product and environment. Missing grants deny access.

Read-only transactions set the restricted titan_config_reader DB role
and transaction-local company/cohort context. Custom PostgreSQL settings
are not proof of identity and clients cannot be allowed arbitrary SQL.
