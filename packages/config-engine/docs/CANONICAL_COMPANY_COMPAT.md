# Company foreign-key compatibility (Issue #43)

The canonical shared-company schema is currently under review in PR #46.
The new CI-only fixture reproduces the titan.companies identifier/status
shape so draft FK 0005 can be exercised on a disposable PostgreSQL 16 instance.
It is **not** a substitute for the central migration registry.

Grant lookups now join the canonical company table and require status='active'.
A grant for a suspended/closed company fails closed. Missing, ambiguous,
revoked and expired grants remain denied. The FK prevents orphan grants.

Do not deploy draft migration 0005 independently. It must be integrated in
the one authoritative ordered migration history once #43 is reviewed.
No production database or live company data has been changed.
