# Central launcher integration

The reconciled source combines PR #49 with current main, including merged PRs #50, #46 and #91. Existing operator, flag-read, configuration-engine, service-decision and activity-recording behavior is retained. Browser routes remain explicitly disabled by default.

## Authentication and resource ownership

- Product and Central OIDC state operations retain transaction-local, least-privilege database roles and one-use encrypted state. Central uses the isolated `titan_central_oidc` namespace; product state remains inaccessible to that role.
- Both existing organization-selection and optional product-selection coordinators are retained; the HTTP adapter refuses conflicting simultaneous selection configurations.
- Selected-company resolution repeats current membership, entitlement and local account checks.
- Browser startup retains product registry validation, link keys, operator configuration, distinct audiences and configuration-engine readiness checks.
- Shared company-name and configuration pools close on startup failure and shutdown. Regression tests cover the real HTTP route composition and closing both pools when the browser factory fails and a close operation rejects.
- Connection limits and HTTP deadlines from the launcher branch are retained.

## Migration numbering

Existing main migrations 0001–0021 are preserved. Duplicate, weaker browser drafts 0010–0012 from #49 are superseded by the role-hardened 0019–0021 already integrated through #91. Remaining unapplied launcher migrations move to unoccupied numbers:

| Draft name | Integrated version |
| --- | --- |
| 0013 central company selection | 0022 |
| 0014 Central session access revocation | 0023 |
| 0015 authorized Central session issuance | 0024 |
| 0016 product account proof nonces | 0025 |
| 0017 product company selection | 0026 |
| 0018 product selection role isolation | 0027 |

The independent `database/migrations` canonical chain remains separate from legacy `migrations`. CI exercises both on separate disposable databases, along with checksum drift, role/RLS isolation, replay rejection, rollback rehearsals and blocked production cutover without external approval evidence. No live migration or deployment is performed by this merge.

## Verification

Local combined JavaScript suites: 1,572 passed, 10 existing TODO cases, zero failed. Python runner/tool suite: 74 tests, one database-dependent skip. Deployment checks: 111 tests passed. GitHub PostgreSQL and browser verification is required for the final reconciled head before merge.
