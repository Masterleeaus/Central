# Disposable Postgres grant-audit checks

CI migration 0006 adds append-only grant history, an AFTER INSERT/UPDATE
trigger, NOLOGIN writer role, column-limited UPDATE grants, and required
actor identification for restricted role writes.

CI checks audit INSERT/UPDATE, revision transition constraints, the
absence of direct audit write grants, NOLOGIN/NO-BYPASSRLS and rejection
of missing actor context. Node tests cover command validation and a
transactional compare-and-swap revision rejection.

This does not establish production identity verification or authorised
grant creation: the management function is not an HTTP endpoint.
