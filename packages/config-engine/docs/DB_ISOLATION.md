# Configuration database isolation status

The new snapshot reader uses a single REPEATABLE READ READ ONLY transaction.
Its SQL parameters filter another company's scoped overrides before returning data.
JS tenant filtering remains defence in depth. Database row-level security and
canonical company foreign keys have **not** been integrated.

The draft roles do not yet isolate all tenant data at the database layer.
Do not expose these roles to untrusted SQL or enable the HTTP route.
Issue #43 must own the authoritative one-database migration sequence.

## Verified scope of disposable SQL assertions

The workflow checks schema creation, permission grants, type constraints,
tenant-key separation, immutable-revision permissions and negative grants.
These checks use a PostgreSQL 16 CI container only, not live data.

Important limitation: different company scope keys in one table are not RLS.
Full SQL-level company authorization remains blocked by the canonical
company/identity migration contract in #43.
