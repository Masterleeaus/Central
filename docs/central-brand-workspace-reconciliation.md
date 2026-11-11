# Central brand and workspace reconciliation

PR #42 is reconciled with current main, including the launcher, configuration engine, activity recording, rate limits, role-scoped OIDC state and revocation stores.

Accepted: Titan Central source identity, editor/Node configuration, root locked npm workspaces, control-plane package exports and contributor commands. Existing newer public branding and historical reports under `docs/records/pass` are retained.

The proposed global `field`/`desk`/`academy` replacement is deferred. These remain legacy access and OIDC contract identifiers; canonical company registration already uses `sorted`/`supercharged`/`lms`/`scheduled`. Replacing the former globally would break distinct audiences, stored rows and adapter validation. Do not equate these namespaces or infer deployment status from a source branch.

All existing SQL in `migrations`, `database/migrations` and configuration-engine SQL remains byte-identical to main. In particular, the old 0001, 0003 and 0004 definitions are not rewritten. A future ID transition requires additive SQL, tested upgrade/replay paths, explicit adapter and audience contracts, and independent deployment authorization.

No live database migration, Logto update, product adapter activation or deployment is performed by this source merge. Incoming commits remain in merge ancestry for traceability.

## Validation

Root `npm ci` and `npm test` passed: 489 control-plane, 901 API, 61 launcher and 182 configuration-engine tests passed; 10 service-dependent tests skipped and one existing owner-configuration TODO remained. Both Python suites passed (111 deployment tests, 73 tools tests and one database-dependent skip). The root package export resolves `CentralAccessService`. GitHub PostgreSQL, migration/replay, RLS and browser verification remains required for the reconciled commit.
