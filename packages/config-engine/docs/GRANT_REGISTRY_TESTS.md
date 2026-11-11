# Disposable grant verification

PostgreSQL 16 CI applies the draft grant table after base config RLS and
tests invalid client, product, environment and state; duplicate grants;
read-only NOLOGIN role privileges; and denial of INSERT and DELETE from
the reader. Node tests check a single scoped grant, ambiguous associations,
rollback on failure, revision and expiry checks.

Tests do not establish a production company FK or prove authorised grant
provisioning. Keep the endpoint disabled pending Issue #43 integration.
