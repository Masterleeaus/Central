# Restricted machine-grant provisioning (draft)

Grant management is server-only and must be invoked by separately verified,
authorised operators; there is deliberately NO HTTP route. The writer role
can INSERT and update only state, expiry, revision and cohorts in the
service-company grant table. No DELETE is granted.

The trigger records every INSERT/UPDATE into an audit table not writable by
the restricted role. The JS client sets a transaction-local actor label and
uses optimistic version comparison on grant changes. A mismatched expected
revision rolls back and cannot create an unrecorded state change.

This is an engineering draft: SQL session actor labels can be forged by
anyone with arbitrary database access. Dedicated login-role provisioning,
authz, production credential separation, audit retention and canonical
shared migration ownership (#43) are still required.
