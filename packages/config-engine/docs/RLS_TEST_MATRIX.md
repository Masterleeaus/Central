# Configuration RLS test matrix

Disposable PostgreSQL 16 tests check FORCE RLS, policy registration,
missing company context, isolated company reads, cohort membership selection,
global defaults, revision isolation, restricted writer's own-company INSERT,
writer denial for another company, and forbidden reader INSERT.

These tests are useful DB-layer proofs for this draft only. They do not
establish browser trust, prevent unsafe database login configuration, or
replace cross-app shared-company tests and live authentication.
