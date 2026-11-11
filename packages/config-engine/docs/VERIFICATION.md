# Issue #38 verification plan

1. Run Node tests: `node --test packages/config-engine/test/*.test.mjs`.
2. On disposable PostgreSQL 16, run SQL 0001 then 0002 and all verify scripts.
3. Exercise simultaneous writers with identical expected revisions and prove one conflict.
4. Enforce canonical company foreign keys and tenant row-level security.
5. Verify live signed M2M issuer/audience/scope validation and denial paths.
6. Confirm audit tables cannot be changed or erased by the application role.
7. Confirm a rolled-back feature stays disabled across services.

The Node tests currently model read/write contracts. They are not a substitute
for the missing full integration and production security checks.
