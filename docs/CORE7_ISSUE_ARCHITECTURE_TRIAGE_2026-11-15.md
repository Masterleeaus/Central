# Titan Zero — seven core GitHub repositories: architecture and issue consolidation audit

**Date:** 2026-11-15 (Australia/Melbourne)
**Scope only:** `Masterleeaus/Scheduled`, `Sorted`, `Skilled`, `Supercharged`, `Central`, `Titan-Zero-Trades-Front-Desk`, `Titan-zero-website`.
**Excluded from changes:** all other repositories, including the superseded Front Desk Pro history repository.

## Trust and completion standard

- This is a source-and-issue triage, not a seven-repository local clone, complete test run, production acceptance or deployment audit.
- Every currently open issue in these seven repositories has a Markdown task checklist at the latest snapshot; this **does not** show the tasks have been implemented. Concurrent developers and workflows may change counts.
- Keep actionable implementation issues open while any source, security, integration or test task is unchecked.
- An *administrative duplicate* may close with all administrative **transfer** boxes verified only once its outstanding implementation acceptance criteria have been carried as unchecked tasks into the named canonical issue. Never treat an administrative merge as implementation completion.
- Do not collapse distinct service source-of-truth, company/tenant scope, owner application boundaries or cross-repository adapter work into a giant generic ticket.

## Snapshot of the seven core repositories

| Repository | Open issues | Issues lacking checklist | Unchecked task items require delivery |
|---|---:|---:|---|
| Scheduled | 29 | 0 | yes |
| Sorted | 42 | 0 | yes |
| Skilled | 56 | 0 | yes |
| Supercharged | 53 | 0 | yes |
| Central | 55 | 0 | yes |
| Titan-Zero-Trades-Front-Desk | 44 | 0 | yes |
| Titan-zero-website | 43 | 0 | yes |
| **Total** | **322** | **0** | **all outstanding unchecked tasks stay open** |

Point-in-time numbers from connected GitHub issue search. Distinguish checklist boxes already checked in GitHub from independently verified implementation evidence.

## Authoritative product boundaries

Source: [Central architecture decisions ADR-009](https://github.com/Masterleeaus/Central/blob/main/TITAN_ARCHITECTURE_DECISIONS.md) and [single installed Front Desk architecture](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/docs/SINGLE-PLUGIN-AI-SERVICES-ARCHITECTURE.md).

- **Central:** Logto-backed canonical identity, company membership, least-privilege service audience, onboarding, cross-app contracts, entitlements, one physical PostgreSQL **target**, ordered migration registry and release gates.
- **Scheduled:** One PlusAgency + Cleanto Laravel application, no Cleanto sidecar, booking/calendar authority **in integrated mode**, availability, transactions, payment and cancellation/recovery.
- **Sorted:** Jobs, quotes/estimates, invoices, field execution and operational/customer history. Consume booking events; do not become another appointment authority. Preserve staff/teams/invoice capabilities.
- **Skilled:** Courses, published training knowledge, assessment and verifiable credentials; provide read-only versioned competency/knowledge contracts and protect private learner/answer data.
- **Supercharged:** Consented communications, inbound/outbound provider events, RAG, hosted Assistant/Agent Team execution, receipts and voice/agent orchestration. No independent booking commit.
- **Front Desk:** **One** installable WordPress plugin, user-facing **Scheduling & Enquiries Manager**; Free local booking/business tools, optional hosted **Titan Zero AI Assistant** and **Titan Zero AI Agent Team** in the existing dashboard. No separately installable Pro add-on or paid-locked bundled PHP. The standalone plugin remains useful offline.
- **Website:** Source/published-static parity, accurate current product page/catalogue and six optional upgrades: Assistant, Agent Team, Supercharged, Scheduled, Sorted, Skilled; no unapproved prices and preserve legacy SEO routes.

### Merged/closed administrative duplicates verified in this pass

1. [Front Desk #13](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/13) **closed duplicate** after five **unchecked implementation acceptance tasks** were added to active [Front Desk #46](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/46): consent/revocation, approvals/handoff, BYO vs hosted, tenant/secret safety, UX and outage/downgrade testing. No software claimed finished.
2. [Website #12](https://github.com/Masterleeaus/Titan-zero-website/issues/12) **closed duplicate** after navigation/mobile/discovery tasks were transferred unchecked to [Website #4](https://github.com/Masterleeaus/Titan-zero-website/issues/4), with SEO/breadcrumb/WordPress URL tasks transferred unchecked to [Website #19](https://github.com/Masterleeaus/Titan-zero-website/issues/19). Canonical hub #11 and epic #9 remain open.
3. Existing earlier evidence-backed **decision** closures: [Supercharged #130](https://github.com/Masterleeaus/Supercharged/issues/130) user-company membership table; [#131](https://github.com/Masterleeaus/Supercharged/issues/131) retain numbered 0001 migration in journal; [#132](https://github.com/Masterleeaus/Supercharged/issues/132) CI native PostgreSQL. These close decisions, **not** migration acceptance tests, security or production cutover.
4. [Central #161](https://github.com/Masterleeaus/Central/issues/161) standalone Pro ZIP fulfilment is retired/not planned, while Central #149/#153/#156/#157 retain actual hosted service work.

### Architecture-drift fixes made to **open** issue specifications

- [Sorted #28](https://github.com/Masterleeaus/Sorted/issues/28): clarified separate product runtimes with shared Central identity/one PostgreSQL target rather than importing all apps into one Sorted monolith. New unchecked reconciliation and test tasks.
- [Central #43](https://github.com/Masterleeaus/Central/issues/43): expanded outdated four-product shared DB registry scope to **five** including Scheduled, adding unchecked migration and tenant verification.
- [Scheduled #56](https://github.com/Masterleeaus/Scheduled/issues/56): differentiated integrated Scheduled authority from standalone WordPress local booking, adding unchecked cutover/idempotency and recovery tests.
- [Skilled #304](https://github.com/Masterleeaus/Skilled/issues/304): clarified read-only published knowledge/verified competency bridge to one installed Front Desk plugin; children #310/#311/#314 stay open.

## Overlapping issues that must remain open as parent/child or different owner components

| Product | Canonical parent / ownership | Keep specialized children open | Why not bulk-close |
|---|---|---|---|
| Front Desk | [#45](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/45) one-plugin product epic, [#1](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/1) original source audit | #46 upgrade, #47 Assistant, #48 Agent Team, #49 legacy functional migration, #19/#42/#43 Free AI foundation | Parent epic and source preservation are distinct from tested feature delivery; old #1 contains incompatible historic Pro implementation wording requiring task realignment |
| Website | [#9](https://github.com/Masterleeaus/Titan-zero-website/issues/9) product epic and [#11](https://github.com/Masterleeaus/Titan-zero-website/issues/11) hub | #4 navigation, #19 SEO, #15 catalogue data, #16 catalogue presentation, #17 in-plugin upgrade content, #1 legacy SEO | The same page may be discussed, but source catalogue/markup/navigation, SEO, billing and cross-product copy each have separate testable work |
| Scheduled | [#46](https://github.com/Masterleeaus/Scheduled/issues/46) one Laravel/no Cleanto sidecar, [#47](https://github.com/Masterleeaus/Scheduled/issues/47) booking E2E, [#56](https://github.com/Masterleeaus/Scheduled/issues/56) Front Desk adapter | #58 atomic booking and holds, #59 lifecycle sync, #62 service/staff/timezone, #64 payment, #67 contract fixtures, #15/#49 PostgreSQL transition | Booking engine authority, API adapter, payment events, DB migration and CI/test failures are different acceptance layers; avoid losing edge-case tests |
| Sorted | [#87](https://github.com/Masterleeaus/Sorted/issues/87) operational E2E, [#99](https://github.com/Masterleeaus/Sorted/issues/99) Front Desk integration | #102 tenant-safe customer/booking/job adapter, #106 quote schemas, #108 quote review, #109 invoices, #110 reconciliation, #86 booking-to-job, #88 PR/CI | Keep invoices/quotes/staff/teams and exact reconciliation tests. #99 is parent; #102 is versioned implementation slice, not duplicate |
| Skilled | [#304](https://github.com/Masterleeaus/Skilled/issues/304) competency/knowledge integration parent and [#297](https://github.com/Masterleeaus/Skilled/issues/297) Central workforce links | #310 published knowledge, #311 competency registry, #314 scoped UI contract, #306/#307 coaching/eligibility, #312 microlearning, #299 PR CI | Learning content does not imply verified staffing credentials; distinct data, security, assessment and runtime acceptance |
| Supercharged | [#325](https://github.com/Masterleeaus/Supercharged/issues/325) hosted Agent Team/voice parent | #328 channel consent/call handoff, #333 telephony, #334 deterministic booking gateway, #338 E2E provider tests, #343 URL-secret remediation, #317 CI/PR merges, #51/#250–254 tenant migrations | Agent tooling cannot bypass booking, consent, signed receipts or tenant boundary; keep source/security-specific tasks |
| Central | [#149](https://github.com/Masterleeaus/Central/issues/149) one-plugin hosted services, [#140](https://github.com/Masterleeaus/Central/issues/140) DB migration, [#160](https://github.com/Masterleeaus/Central/issues/160) release go/no-go | #152 pairing, #153 subscription billing, #156 catalogue, #157 upgrade/checkout, #154 receipts, #141 sign-in, #142 release ops, #167 local legacy audit, #168 seven-repo governance audit | Service entitlements, billing, org authority, company boundaries, release and historic issue verification have separately verifiable outputs |

## Source-backed work that must be fixed, not administratively closed

- **Website:** [#43](https://github.com/Masterleeaus/Titan-zero-website/issues/43) leaks business context into URL handoff params; #42 precision/testable calculator engine, #46 generated/source publishing parity.
- **Scheduled:** [#55](https://github.com/Masterleeaus/Scheduled/issues/55) PHP Plivo namespace parse issues; [#54](https://github.com/Masterleeaus/Scheduled/issues/54) committed payment gateway salt; #50 fresh-install migration registry; #51 CI unexercised tests; #53 MySQL-specific SQL; #76 public orphan /backup route; #47 booking acceptance.
- **Sorted:** [#100](https://github.com/Masterleeaus/Sorted/issues/100) migration prefix collision; #95 audit log company_id missing column; #96 timezone-sensitive tests; #97 manifest drift; #98 rollback gaps; #88 conflicting open PR/CI.
- **Skilled:** [#300](https://github.com/Masterleeaus/Skilled/issues/300) auth/course access checks; #301 live-class meeting link exposure; #302 migration rollbacks; #303 ESLint version mismatch; #299 merge/CI checks.
- **Supercharged:** [#2](https://github.com/Masterleeaus/Supercharged/issues/2) tracked webhook secret exposure/rotation; [#343](https://github.com/Masterleeaus/Supercharged/issues/343) secret-containing webhook URL; #319 voice webhook route shadowing; #320 route auth coverage; #317 PR typecheck/build.
- **Central:** [#151](https://github.com/Masterleeaus/Central/issues/151) hard-coded CI password; #145 skipped PostgreSQL tests; #144 unrun conformance suite; #146 stale/future envelopes; #140 five-product shared migration.
- **Front Desk:** #3 WordPress.org licensing/provenance gate, #7 booking regression/upgrade, #8 auth/privacy, #44 optional hosted-AI serviceware and consent release gate.

## Decisions and active backlog boundaries

- [Scheduled #11](https://github.com/Masterleeaus/Scheduled/issues/11): booking ownership **decision** is recorded by Central ADR-009, but the reminder/appointment overlap inventory, canonical registry references and migration/contract acceptance still need verification. Keep the issue open until its original checklist is satisfied, or transfer all remaining technical work to canonical owners before retiring a pure decision tracker.
- [Sorted #28](https://github.com/Masterleeaus/Sorted/issues/28) imported app sources may be historical experiments; do not treat it as approval for a merged monolith.
- [Central #167](https://github.com/Masterleeaus/Central/issues/167) audits Central's 27 historical closures; [#168](https://github.com/Masterleeaus/Central/issues/168) coordinates historical audits **across the seven**. These are parent/child, not identical duplicates.
- Other historical closed issues cannot be auto-certifed by the prospective closure gate; historic disposition requires source/CI evidence or reopening with incomplete tasks.

## Operational rules for other agents

1. Re-fetch issue state and body before every edit: concurrent agents are active. Preserve all currently checked items and new comments.
2. Before merging duplicates, compare acceptance criteria, transfer each unique unfinished requirement as `- [ ]` to canonical open issues, then re-fetch to verify transfer.
3. The merged administrative tracker must document exactly what was transferred and where; a closed duplicate is **not** software delivered.
4. Do not falsely check implementation tasks to satisfy the closure gate. Close completed implementation only when its own code and tests are verified.
5. Never assume a ticket with the word “Pro” requires a second WordPress plugin. Source authority is the single-plugin architecture and Central ADR-009.
6. Keep only these seven repos in scope; do not mutate historical source repositories or other Titan workspaces as part of this review.
