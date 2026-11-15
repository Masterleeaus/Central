# Titan Zero — Seven-Core-Repository Issue & Architecture Reconciliation

Snapshot: 2026-11-15 (live GitHub issue reads; concurrent agents may change status after this scan). Scope deliberately excludes all other repositories, including historical planning repositories.

## Pass 2 — verified fixes and closeouts (15 November 2026)

This pass is strictly restricted to the **seven core repositories**. The previous 319-open-issue register below remains a historical snapshot; this addendum records the later verified current status and does not rewrite history.

### Updated live issue counts

| Core repo | Open issues | Unchecked checklist tasks |
|---|---:|---:|
| Scheduled | 25 | 154 |
| Sorted | 42 | 364 |
| Skilled | 53 | 444 |
| Supercharged | 53 | 472 |
| Central | 53 | 464 |
| Titan-Zero-Trades-Front-Desk | 44 | 554 |
| Titan-zero-website | 44 | 367 |
| **Total** | **314** | **2,819** |

Every one of the 314 open issues had a Markdown checklist in this refreshed query. These are *issue tracking* quantities, not implementation completion percentages.

### Merged code and verified issue resolution

- **Scheduled [PR #78](https://github.com/Masterleeaus/Scheduled/pull/78)**: added `tests/cleanto_booking_api_syntax_contract_test.php`, an executable PHP lint gate for all seven named Cleanto legacy booking API files. Merged as `fa92b1a6d4d96400553261b81d635be6c17fc725`; [Actions green](https://github.com/Masterleeaus/Scheduled/actions/runs/43711690833). Closed [#55](https://github.com/Masterleeaus/Scheduled/issues/55) after source and syntax verification. The original scan said eight files, but enumerated seven distinct paths.
- **Scheduled [#50](https://github.com/Masterleeaus/Scheduled/issues/50), [#51](https://github.com/Masterleeaus/Scheduled/issues/51), [#52](https://github.com/Masterleeaus/Scheduled/issues/52)**: older migration allowlist, standalone PHP CI and 10-vs-19-template test findings rechecked; actual 2026 migration set has 22 files, test/discovery source matches, PHP CI successfully runs the scripts, and the tests now assert 19 templates. Each narrow defect closed with checked evidence; full clean installer, provider payments and publishing acceptance remain open under Scheduled #46–#49.
- **Central [#144](https://github.com/Masterleeaus/Central/issues/144), [#145](https://github.com/Masterleeaus/Central/issues/145)**: verified actual [CI run](https://github.com/Masterleeaus/Central/actions/runs/43710732638) includes required Scheduled conformance (67 tests, 65 passed, 2 TODO, 0 failures) and PostgreSQL feature-flag tests (1,016 passed, 0 skipped). Both *CI omission* issues closed with their verified task checklists; cross-product staging remains open under Central #140/#160.
- **Skilled [PR #321](https://github.com/Masterleeaus/Skilled/pull/321)**: merged `46e4a57541b28476e2b3532c0238db3d3d2e6b9c`. Scoped discussion write access to current course ownership and enrolment, refused unpublished/deleted course writes, checked course authorization before loading private thread bodies, and added 10 real Express/JWT HTTP regression tests. The [backend/postgres/typecheck gates](https://github.com/Masterleeaus/Skilled/actions/runs/43712354676) and [curriculum gate](https://github.com/Masterleeaus/Skilled/actions/runs/43712354675) passed. [#300](https://github.com/Masterleeaus/Skilled/issues/300) remains open pending deployed multi-tenant PostgreSQL acceptance and security review.

### Blocked / overlapping source work

- **Supercharged [PR #346](https://github.com/Masterleeaus/Supercharged/pull/346)**: implements proposed fail-closed Origin/Referer checking on `POST /widget/session/start` (aligns with config GET), refuses malformed origins/body types, and adds five security tests. All **five new tests passed** in [PR CI](https://github.com/Masterleeaus/Supercharged/actions/runs/43713067688); however, the overall PR workflow **failed** (fresh-Postgres `0018` references missing `u.company_id`, Inbox suppression check, migration 0020 assertion, and route-auth allowlist). **Not merged**. Both #345 and #346 overlap; preserve unique tests, select one canonical patch and keep release gates enforced.
- **Supercharged [PR #345](https://github.com/Masterleeaus/Supercharged/pull/345)** overlaps #346 and must be reconciled to one canonical security fix, with unique tests preserved. Neither PR proves browser/provider runtime acceptance, and Origin headers alone are not authentication.
- High-risk issues still open: Sorted #88/#100/#95, Supercharged #317/#343, Central #140/#141/#160, Skilled #300/#301, Scheduled #46/#47/#49 and Front Desk #45–#49. Do not tick remaining implementation work without reproducible evidence.

## Architecture invariants
- Single Scheduling & Enquiries Manager WordPress plugin, with optional hosted AI Assistant and Agent Team; no separate Pro-installable deliverable.
- Central is the authoritative identity authority and the target single PostgreSQL migration registry for Scheduled, Sorted, Skilled, Supercharged, Central.
- Scheduled owns booking and calendar state; Sorted owns field jobs; Skilled owns verified learning/competencies; Supercharged owns communications and autonomous agents.
- An epic may stay open alongside detailed child issues; matching words do not prove two implementation tickets duplicate each other.
- Closing duplicates or obsolete architecture tickets does not prove software implementation. Move outstanding acceptance tasks into the correct open ticket, leave them unchecked, and cite code/tests before completion.

## Issue coverage
| Core repository | Open issues | Closed issues | Open checklists | Unchecked tasks | Missing open checklists |
|---|---:|---:|---:|---:|---:|
| [Scheduled](https://github.com/Masterleeaus/Scheduled) | 28 | 2 | 188 | 180 | 0 |
| [Sorted](https://github.com/Masterleeaus/Sorted) | 42 | 22 | 364 | 364 | 0 |
| [Skilled](https://github.com/Masterleeaus/Skilled) | 53 | 71 | 442 | 442 | 0 |
| [Supercharged](https://github.com/Masterleeaus/Supercharged) | 53 | 87 | 472 | 472 | 0 |
| [Central](https://github.com/Masterleeaus/Central) | 55 | 29 | 482 | 476 | 0 |
| [Titan-Zero-Trades-Front-Desk](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk) | 44 | 6 | 556 | 554 | 0 |
| [Titan-zero-website](https://github.com/Masterleeaus/Titan-zero-website) | 44 | 5 | 371 | 367 | 0 |

The checklist numbers are **tracking-state measurements** only; unchecked does not prove missing code, and checked does not replace test evidence. Closed-issue historical verification remains under Website #52, Skilled #320, Central #167, Sorted #115 and Supercharged #344.

## High-confidence architecture reconciliation decisions
| Repository | Issue(s) | Disposition | Remaining obligation |
|---|---|---|---|
| Scheduled | 1 | Completed decision | Central registry now contains the `scheduled` product ID, audience, no legacy ID; remaining staging duties retained in Central #100. |
| Scheduled | 11 | Completed decision | Booking/calendar ownership resolved by ADR-009; migration and cross-app tests tracked in Scheduled #56 and Supercharged #315. |
| Scheduled | 76 | Source fix merged, issue OPEN | Removed orphan public backup route in PR #77, passing CI; disposable HTTP acceptance remains unchecked. |
| Sorted | 36 → 37 | Duplicate tracker consolidated | EdDSA signer requirements transferred to canonical Sorted #37. |
| Sorted | 38 → 35 | Duplicate tracker consolidated | Central OIDC sign-in requirements transferred to canonical Sorted #35. |
| Skilled | 152 → 198; 153 → 195; 154 → 196; 156 → 194; 157 → 199; 159 → 197 | Duplicate drafts consolidated | Course/vertical draft constraints transferred; production course and human review remain open. |
| Skilled | 306 → 310; 307 → 311; 308 → 312 | Duplicate integration trackers consolidated | Published knowledge, competency eligibility, microlearning scope retained under canonical delivery issues. |
| Supercharged | 193 → 53 | Duplicate tracker consolidated | OIDC sign-in expectations transferred to Supercharged #53. |
| Titan-zero-website | 12 → 4/19; 13 → 1/11/14 | Duplicate / superseded tracker consolidated | Navigation, SEO and legacy URL work retained without retaining obsolete Pro-download plans. |
| Central | 161 → 157 | Superseded architecture ticket | Retired separate Pro ZIP fulfilment, retained hosted entitlement/transfer security in Central #157. |
| Titan-zero-website | 51 → 52 | Duplicate governance audit | One historical-issue review kept in canonical audit. |
| Skilled | 319 → 320 | Duplicate governance audit | Historical verification checklist preserved in canonical audit. |
| Central | 166 → 167 | Duplicate governance audit | Historical verification checklist preserved in canonical audit. |
| Sorted | 114 → 115 | Duplicate governance audit | Historical verification checklist preserved in canonical audit. |
| Supercharged | 342 → 344 | Duplicate governance audit | Historical verification checklist preserved in canonical audit. |

## Release-critical next actions
- **P0 Scheduled:** #50 fresh-install migration registration; #54 committed gateway credential remediation; #55 broken PHP syntax; #76 disposable route smoke after merged PR #77; #46/#47/#49 unified booking and PostgreSQL cutover.
- **P0 Sorted:** #88 and #100 clean main-branch CI and migration collisions; #95 tenant audit schema bug; #86 booking-to-job integration; maintain invoice and staff/team functionality.
- **P0 Skilled:** #300/#301 discussion and class-record access security; #302 rollback migrations; #68/#210 company and Central integration; #299 reconcile release PRs; keep human content approval gates.
- **P0 Supercharged:** #343 webhook-secret exposure; #319 Plivo webhook routing; #317 failing CI and conflicting PRs; #51 shared tenancy cutover; #333/#334/#338 voice-to-booking acceptance, not independent booking authority.
- **P0 Central:** #140 shared physical PostgreSQL and migration authority; #141 unified login; #145 skipped DB tests; #144 Scheduled conformance CI; #146 envelope recency protections; #160 integrated go/no-go.
- **P0 Front Desk:** #45 one-plugin epic; #46 hosted upgrade entitlements, #47 Assistant, #48 Agent Team, #49 legacy feature reconciliation; #7 install/booking tests and #8 permissions/security.
- **P0 Website:** #9 authoritative product epic, #11 product hub, #4 navigation, #19 SEO/breadcrumb, #21 static generation drift, #43 privacy, #46 release checks; do not publish unsupported checkout or Pro ZIP.

## Live open-issue register (all seven core repositories)
This register includes **every open GitHub issue returned by the repository-scoped query** at snapshot time; titles and checklist counts are factual. The “workstream” column is a routing aid, **not** an implementation verdict or permission to close.

### [Scheduled](https://github.com/Masterleeaus/Scheduled/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#76](https://github.com/Masterleeaus/Scheduled/issues/76) | Product implementation | 6/9 | [P1 Scan] Remove or secure orphan public /backup route referencing missing controller method |
| [#67](https://github.com/Masterleeaus/Scheduled/issues/67) | Cross-product contract | 9/9 | P0 FRONT DESK: certify one-plugin booking contracts (Free / hosted Assistant / Agent Team) |
| [#65](https://github.com/Masterleeaus/Scheduled/issues/65) | Feature / integration | 7/7 | P1 OPERATIONS: booking recovery dashboards, queue observability and provider health |
| [#64](https://github.com/Masterleeaus/Scheduled/issues/64) | Feature / integration | 7/7 | P1 BOOKING COMMERCE: deposits, checkout state, payment callbacks and recovery |
| [#63](https://github.com/Masterleeaus/Scheduled/issues/63) | Feature / integration | 7/7 | P1 SCHEDULING: recurring service, route grouping and AI scheduling recommendation evaluation |
| [#62](https://github.com/Masterleeaus/Scheduled/issues/62) | Cross-product contract | 7/7 | P0 CONTRACTS: Front Desk service pricing, location, staffing and timezone mapping |
| [#60](https://github.com/Masterleeaus/Scheduled/issues/60) | Feature / integration | 6/6 | P1 Paid AI scheduling optimisation for home and field services |
| [#59](https://github.com/Masterleeaus/Scheduled/issues/59) | Feature / integration | 7/7 | P1 Front Desk cancellations, reschedules, waitlist and event reconciliation |
| [#58](https://github.com/Masterleeaus/Scheduled/issues/58) | Cross-product contract | 8/8 | P0 Front Desk booking source-of-truth contract: availability and atomic commit |
| [#56](https://github.com/Masterleeaus/Scheduled/issues/56) | Epic / integration parent | 11/11 | Front Desk integration: booking availability, holds and transactional synchronisation |
| [#55](https://github.com/Masterleeaus/Scheduled/issues/55) | Defect / verification | 10/10 | [Scan] Eight Cleanto API files fail php -l: whitespace in Plivo\ RestAPI namespace |
| [#54](https://github.com/Masterleeaus/Scheduled/issues/54) | Defect / verification | 5/5 | [Scan] PayUmoney gateway salt committed in installer/database.sql |
| [#53](https://github.com/Masterleeaus/Scheduled/issues/53) | Defect / verification | 10/10 | [Scan] MySQL-only SQL in booking claim ledger and schema readers, not in #15 inventory |
| [#52](https://github.com/Masterleeaus/Scheduled/issues/52) | Defect / verification | 6/6 | [Scan] Site template tests expect 10 templates but SiteTemplates::catalog() returns 19 |
| [#51](https://github.com/Masterleeaus/Scheduled/issues/51) | Defect / verification | 10/10 | [Scan] CI runs only tests/run.php; 12 other PHP test scripts fail when run directly |
| [#50](https://github.com/Masterleeaus/Scheduled/issues/50) | Defect / verification | 5/5 | [Scan] Fresh install fails: two 2026_11_15 migrations missing from InitialFeatureMigrations list |
| [#49](https://github.com/Masterleeaus/Scheduled/issues/49) | Cross-product contract | 6/6 | [P0] Port installer, preflight, queues and booking persistence to central PostgreSQL and Central OIDC |
| [#48](https://github.com/Masterleeaus/Scheduled/issues/48) | Feature / integration | 6/6 | [P1] Complete integrated ten-template website and landing-page builder with publishing |
| [#47](https://github.com/Masterleeaus/Scheduled/issues/47) | Feature / integration | 7/7 | [P0] Finish booking engine end to end: availability, checkout, assignment, payments and recovery |
| [#46](https://github.com/Masterleeaus/Scheduled/issues/46) | Feature / integration | 7/7 | [P0] Eliminate Cleanto sidecar: one Laravel Scheduled application, runtime and booking authority |
| [#15](https://github.com/Masterleeaus/Scheduled/issues/15) | Cross-product contract | 5/5 | Migrate Scheduled database from MySQL/MariaDB to PostgreSQL |
| [#10](https://github.com/Masterleeaus/Scheduled/issues/10) | Product implementation | 2/6 | Confirm repository visibility, licence and secret scan before importing source |
| [#7](https://github.com/Masterleeaus/Scheduled/issues/7) | Cross-product contract | 7/8 | [P0] Establish Scheduled source, product contract and shared PostgreSQL integration |
| [#6](https://github.com/Masterleeaus/Scheduled/issues/6) | Cross-product contract | 3/3 | Central integration: consume feature flags and signed outbox events |
| [#5](https://github.com/Masterleeaus/Scheduled/issues/5) | Cross-product contract | 6/6 | Central integration: tenant model, memberships and the company column |
| [#4](https://github.com/Masterleeaus/Scheduled/issues/4) | Cross-product contract | 3/3 | Central integration: service calls with client credentials and product audience |
| [#3](https://github.com/Masterleeaus/Scheduled/issues/3) | Cross-product contract | 3/3 | Central integration: sign-in via Central OIDC (PKCE, per-app audience) |
| [#2](https://github.com/Masterleeaus/Scheduled/issues/2) | Cross-product contract | 4/4 | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) |

### [Sorted](https://github.com/Masterleeaus/Sorted/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#115](https://github.com/Masterleeaus/Sorted/issues/115) | Legacy verification | 28/28 | [Governance] Verify 19 legacy closed issues against task-completion policy |
| [#110](https://github.com/Masterleeaus/Sorted/issues/110) | Cross-product contract | 8/8 | P1 CONTRACTS: one-plugin customer/booking/quote/invoice reconciliation for Assistant/Agent Team |
| [#109](https://github.com/Masterleeaus/Sorted/issues/109) | Product implementation | 9/9 | P1 REVENUE: invoices, payments, service agreements and recurring job handoff |
| [#108](https://github.com/Masterleeaus/Sorted/issues/108) | Feature / integration | 9/9 | P1 QUOTES: AI-assisted estimate review UI and conversion to scheduled work |
| [#107](https://github.com/Masterleeaus/Sorted/issues/107) | Feature / integration | 9/9 | P1 FIELD: mobile service job execution, photo evidence and customer-facing status |
| [#106](https://github.com/Masterleeaus/Sorted/issues/106) | Cross-product contract | 9/9 | P0 CONTRACTS: Front Desk estimate and quote request schemas with approved rate cards |
| [#104](https://github.com/Masterleeaus/Sorted/issues/104) | Feature / integration | 9/9 | P1 Front Desk service follow-through: field documentation, payment handoff and Smart Task receipts |
| [#103](https://github.com/Masterleeaus/Sorted/issues/103) | Feature / integration | 10/10 | P1 Paid AI Estimator: photo-based scope and reviewable service quotations |
| [#102](https://github.com/Masterleeaus/Sorted/issues/102) | Cross-product contract | 9/9 | P0 Front Desk lead-to-job adapter: tenant-safe customer, booking and work-order synchronisation |
| [#100](https://github.com/Masterleeaus/Sorted/issues/100) | Defect / verification | 5/5 | main fails the migration prefix guard: 209 and 210 collide |
| [#99](https://github.com/Masterleeaus/Sorted/issues/99) | Epic / integration parent | 5/5 | Front Desk integration: convert enquiries/bookings to jobs and optional quote requests |
| [#98](https://github.com/Masterleeaus/Sorted/issues/98) | Defect / verification | 5/5 | [Scan] 218 SQL migrations have no reversal files; some rewrite constraints without a rollback plan |
| [#97](https://github.com/Masterleeaus/Sorted/issues/97) | Defect / verification | 7/7 | [Scan] check-titan-manifest reports 4 checksum-drift errors on main and is not run by CI |
| [#96](https://github.com/Masterleeaus/Sorted/issues/96) | Defect / verification | 4/4 | [Scan] Walkthrough date test depends on host timezone (passes in UTC, fails in Melbourne) |
| [#95](https://github.com/Masterleeaus/Sorted/issues/95) | Defect / verification | 6/6 | [Scan] appendAuditLog writes company_id to audit_log, which has no company_id column |
| [#94](https://github.com/Masterleeaus/Sorted/issues/94) | Defect / verification | 7/7 | [Scan] 14 web unit tests expect old navigation labels (Today, Desk, Jobs, Workforce) |
| [#93](https://github.com/Masterleeaus/Sorted/issues/93) | Defect / verification | 4/4 | [Scan] titan-builder runtime bridge test fails: expected card, got summary-banner (cause unverified) |
| [#92](https://github.com/Masterleeaus/Sorted/issues/92) | Defect / verification | 4/4 | [Scan] Five-tier delegation test expects titan.worker.place_call_agent, which is not in the org graph |
| [#91](https://github.com/Masterleeaus/Sorted/issues/91) | Defect / verification | 4/4 | [Scan] titan-platform interface-runtime-native test imports PresentationComposer, which is not defined |
| [#90](https://github.com/Masterleeaus/Sorted/issues/90) | Defect / verification | 4/4 | [Scan] titan-platform directadmin-bridge test imports missing apps/directadmin/zero-core/cockpit.mjs |
| [#89](https://github.com/Masterleeaus/Sorted/issues/89) | Defect / verification | 6/6 | [Scan] titan-platform tests read missing apps/web builder files (9 test files) |
| [#88](https://github.com/Masterleeaus/Sorted/issues/88) | Defect / verification | 5/5 | [P0] Reconcile open overlapping Sorted integration PRs and get CI green on main |
| [#87](https://github.com/Masterleeaus/Sorted/issues/87) | Feature / integration | 6/6 | [P1] Verify and finish Sorted operational workflows from quote through invoicing, teams and mobile |
| [#86](https://github.com/Masterleeaus/Sorted/issues/86) | Cross-product contract | 6/6 | [P0] Complete Sorted → Scheduled booking-to-job lifecycle on canonical company_id |
| [#44](https://github.com/Masterleeaus/Sorted/issues/44) | Epic / integration parent | 42/42 | Upgrade plan: Sorted |
| [#42](https://github.com/Masterleeaus/Sorted/issues/42) | Cross-product contract | 6/6 | [P0] Verify Sorted end-to-end integration against Central and shared PostgreSQL |
| [#41](https://github.com/Masterleeaus/Sorted/issues/41) | Cross-product contract | 4/4 | Central integration: consume feature flags and signed outbox events |
| [#40](https://github.com/Masterleeaus/Sorted/issues/40) | Cross-product contract | 3/3 | Central integration: tenant model, memberships and the company column |
| [#39](https://github.com/Masterleeaus/Sorted/issues/39) | Cross-product contract | 4/4 | Central integration: service calls with client credentials and product audience |
| [#37](https://github.com/Masterleeaus/Sorted/issues/37) | Cross-product contract | 9/9 | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) |
| [#35](https://github.com/Masterleeaus/Sorted/issues/35) | Product implementation | 14/14 | Central session adapter and account mapping (Central issue #26) |
| [#34](https://github.com/Masterleeaus/Sorted/issues/34) | Product implementation | 10/10 | Remove committed archive and add ignore rules; check it for secrets first |
| [#29](https://github.com/Masterleeaus/Sorted/issues/29) | Product implementation | 14/14 | [Brand] Complete the Sorted Field rebrand and preserve Supercharged Desk identity |
| [#28](https://github.com/Masterleeaus/Sorted/issues/28) | Product implementation | 13/13 | [Architecture] Integrate Sorted, Supercharged, and LMS on shared identity and company context |
| [#27](https://github.com/Masterleeaus/Sorted/issues/27) | Feature / integration | 10/10 | [Integration] Connect Supercharged Desk Marketing and Inbox to shared company/customer records |
| [#26](https://github.com/Masterleeaus/Sorted/issues/26) | Cross-product contract | 10/10 | Move Sorted onto the shared company_id schema and Central migration chain |
| [#15](https://github.com/Masterleeaus/Sorted/issues/15) | Product implementation | 10/10 | [Database] Reconcile worker RLS policy with cross-account automation sweeps |
| [#12](https://github.com/Masterleeaus/Sorted/issues/12) | Product implementation | 7/7 | [Repository policy] Decide the license and distribution boundary for this public codebase |
| [#10](https://github.com/Masterleeaus/Sorted/issues/10) | Defect / verification | 7/7 | [CI governance] Protect main with the checks documented as required |
| [#6](https://github.com/Masterleeaus/Sorted/issues/6) | Defect / verification | 8/8 | [Security] Run the application with a least-privilege database role and enforce tenant isolation |
| [#5](https://github.com/Masterleeaus/Sorted/issues/5) | Product implementation | 8/8 | [Intake] Implement secure photo attachments for public service requests |
| [#4](https://github.com/Masterleeaus/Sorted/issues/4) | Defect / verification | 7/7 | [CI] Resolve the 754 Knip unused-file findings without hiding real dead code |

### [Skilled](https://github.com/Masterleeaus/Skilled/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#320](https://github.com/Masterleeaus/Skilled/issues/320) | Legacy verification | 74/74 | [Governance] Verify 61 legacy closed issues against task-completion policy |
| [#314](https://github.com/Masterleeaus/Skilled/issues/314) | Cross-product contract | 9/9 | P1 FRONT DESK: scoped staff competency and permission UI contracts (one-plugin architecture) |
| [#313](https://github.com/Masterleeaus/Skilled/issues/313) | Curriculum / content | 8/8 | P1 SKILLED: organisation onboarding, course mapping and training adoption reports for Front Desk customers |
| [#312](https://github.com/Masterleeaus/Skilled/issues/312) | Product implementation | 11/11 | P1 SKILLED: service workflow microlearning and manager-approved coaching recommendations |
| [#311](https://github.com/Masterleeaus/Skilled/issues/311) | Product implementation | 10/10 | P1 SKILLED: competency registry crosswalk for staff-role dispatch eligibility |
| [#310](https://github.com/Masterleeaus/Skilled/issues/310) | Curriculum / content | 11/11 | P0 SKILLED: Front Desk service-vertical knowledge API and published revision access |
| [#304](https://github.com/Masterleeaus/Skilled/issues/304) | Curriculum / content | 8/8 | Front Desk service-vertical AI coaching and verified staff competency bridge |
| [#303](https://github.com/Masterleeaus/Skilled/issues/303) | Defect / verification | 10/10 | [Scan] Shared eslint config targets eslint 9 while the apps resolve eslint 10 |
| [#302](https://github.com/Masterleeaus/Skilled/issues/302) | Defect / verification | 10/10 | [Scan] Three non-additive migrations ship without a rollback file |
| [#301](https://github.com/Masterleeaus/Skilled/issues/301) | Defect / verification | 5/5 | [Scan] Unauthenticated live-class list exposes meeting links and recording URLs |
| [#300](https://github.com/Masterleeaus/Skilled/issues/300) | Defect / verification | 5/5 | [Scan] Discussion routes return threads and replies without authentication or course-access checks |
| [#299](https://github.com/Masterleeaus/Skilled/issues/299) | Curriculum / content | 4/4 | [P0] Reconcile Skilled open curriculum and authentication PRs without regressing current main |
| [#298](https://github.com/Masterleeaus/Skilled/issues/298) | Defect / verification | 6/6 | [P1] Complete learner, assessor, manager and payment journeys with verified CI |
| [#297](https://github.com/Masterleeaus/Skilled/issues/297) | Feature / integration | 6/6 | [P0] Connect Skilled training, enrolment and verified competencies to Central and Sorted workforce |
| [#210](https://github.com/Masterleeaus/Skilled/issues/210) | Cross-product contract | 6/6 | [P0] Verify Skilled/LMS shared PostgreSQL and Central integration end to end |
| [#209](https://github.com/Masterleeaus/Skilled/issues/209) | Cross-product contract | 4/4 | Central integration: service calls with client credentials and LMS audience |
| [#208](https://github.com/Masterleeaus/Skilled/issues/208) | Cross-product contract | 3/3 | Central integration: feature flags and signed outbox events |
| [#207](https://github.com/Masterleeaus/Skilled/issues/207) | Cross-product contract | 3/3 | Central integration: tenant model, memberships and the company column |
| [#206](https://github.com/Masterleeaus/Skilled/issues/206) | Cross-product contract | 4/4 | Central integration: service decision client with 5-minute expiry |
| [#205](https://github.com/Masterleeaus/Skilled/issues/205) | Cross-product contract | 3/3 | Central integration: sign-in via Central OIDC (PKCE, per-app audience) |
| [#204](https://github.com/Masterleeaus/Skilled/issues/204) | Cross-product contract | 3/3 | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) |
| [#199](https://github.com/Masterleeaus/Skilled/issues/199) | Curriculum / content | 12/12 | New course: Short-stay host management |
| [#198](https://github.com/Masterleeaus/Skilled/issues/198) | Curriculum / content | 13/13 | New course: Tutoring |
| [#197](https://github.com/Masterleeaus/Skilled/issues/197) | Curriculum / content | 13/13 | New course: Nutrition, weight loss and dieting consultant |
| [#196](https://github.com/Masterleeaus/Skilled/issues/196) | Curriculum / content | 9/9 | New course: Mobile nail technology |
| [#195](https://github.com/Masterleeaus/Skilled/issues/195) | Curriculum / content | 10/10 | New course: Makeup artistry |
| [#194](https://github.com/Masterleeaus/Skilled/issues/194) | Curriculum / content | 9/9 | New course: Dog training |
| [#193](https://github.com/Masterleeaus/Skilled/issues/193) | Curriculum / content | 6/6 | Education and specialist courses (2) |
| [#192](https://github.com/Masterleeaus/Skilled/issues/192) | Curriculum / content | 6/6 | Property and hospitality courses (2) |
| [#191](https://github.com/Masterleeaus/Skilled/issues/191) | Curriculum / content | 3/3 | Health, fitness and wellbeing courses (3) |
| [#190](https://github.com/Masterleeaus/Skilled/issues/190) | Curriculum / content | 5/5 | Personal services and beauty courses (5) |
| [#189](https://github.com/Masterleeaus/Skilled/issues/189) | Curriculum / content | 4/4 | Pet services courses (4) |
| [#188](https://github.com/Masterleeaus/Skilled/issues/188) | Curriculum / content | 7/7 | Outdoor and garden courses (7) |
| [#187](https://github.com/Masterleeaus/Skilled/issues/187) | Curriculum / content | 9/9 | Trades and property maintenance courses (9) |
| [#186](https://github.com/Masterleeaus/Skilled/issues/186) | Curriculum / content | 3/3 | Vehicles, appliances and furniture courses (3) |
| [#185](https://github.com/Masterleeaus/Skilled/issues/185) | Curriculum / content | 15/15 | Cleaning services courses (15) |
| [#175](https://github.com/Masterleeaus/Skilled/issues/175) | Cross-product contract | 4/4 | [Plan P1] Confirm the production PostgreSQL version on the host |
| [#169](https://github.com/Masterleeaus/Skilled/issues/169) | Product implementation | 5/5 | [Plan P4] Compose: pin MinIO image and keep local-dev file off servers |
| [#160](https://github.com/Masterleeaus/Skilled/issues/160) | Curriculum / content | 4/4 | [Plan P2] Wire the six new courses into every mapping file |
| [#147](https://github.com/Masterleeaus/Skilled/issues/147) | Curriculum / content | 4/4 | [Plan] Owner decisions: hold list, draft-only verticals, regulated reviewers |
| [#86](https://github.com/Masterleeaus/Skilled/issues/86) | Curriculum / content | 10/10 | [Brand] Remove legacy Titan Academy naming from learner-visible curriculum |
| [#72](https://github.com/Masterleeaus/Skilled/issues/72) | Product implementation | 10/10 | [Brand and structure] Rebrand to SkilledAt.Work and consolidate the app source |
| [#71](https://github.com/Masterleeaus/Skilled/issues/71) | Product implementation | 10/10 | [Central] Implement and verify Skilled's Central sign-in adapter |
| [#68](https://github.com/Masterleeaus/Skilled/issues/68) | Cross-product contract | 10/10 | Move Skilled onto the shared company_id schema and Central migration chain |
| [#35](https://github.com/Masterleeaus/Skilled/issues/35) | Feature / integration | 7/7 | [P1][ACA-022] Rehearse isolated deployment, secrets, backup and recovery runbooks |
| [#34](https://github.com/Masterleeaus/Skilled/issues/34) | Curriculum / content | 7/7 | [P0][ACA-024] Obtain expert review for high-risk and regulated curriculum |
| [#26](https://github.com/Masterleeaus/Skilled/issues/26) | Defect / verification | 6/6 | [P1][ACA-020] Run curriculum quality gates in GitHub CI |
| [#24](https://github.com/Masterleeaus/Skilled/issues/24) | Curriculum / content | 6/6 | [P1][ACA-011] Review all curriculum transfer and reuse classifications |
| [#21](https://github.com/Masterleeaus/Skilled/issues/21) | Curriculum / content | 6/6 | [P1][ACA-010] Reconcile curriculum briefs with expanded lesson drafts |
| [#20](https://github.com/Masterleeaus/Skilled/issues/20) | Curriculum / content | 6/6 | [P0][ACA-006] Map unmapped lesson drafts to approved courses |
| [#19](https://github.com/Masterleeaus/Skilled/issues/19) | Curriculum / content | 6/6 | [P0][ACA-007] Review curriculum drafts without measurable learning outcomes |
| [#17](https://github.com/Masterleeaus/Skilled/issues/17) | Curriculum / content | 6/6 | [P0][ACA-005] Reconcile curriculum drafts missing usable instructional sections |
| [#9](https://github.com/Masterleeaus/Skilled/issues/9) | Feature / integration | 8/8 | [P1] Verify current main end to end: API, browser, learner and assessor flows |

### [Supercharged](https://github.com/Masterleeaus/Supercharged/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#344](https://github.com/Masterleeaus/Supercharged/issues/344) | Legacy verification | 96/96 | [Governance] Verify 82 legacy closed issues against task-completion policy |
| [#343](https://github.com/Masterleeaus/Supercharged/issues/343) | Defect / verification | 7/7 | [P0 Security] Remove appointment webhook secrets from URL paths and verify signed delivery |
| [#338](https://github.com/Masterleeaus/Supercharged/issues/338) | Defect / verification | 9/9 | P0 AGENT: deterministic provider sandbox and end-to-end voice-to-booking test suite |
| [#337](https://github.com/Masterleeaus/Supercharged/issues/337) | Product implementation | 9/9 | P1 OPERATIONS: conversation dashboard, human inbox, summary and action approvals |
| [#336](https://github.com/Masterleeaus/Supercharged/issues/336) | Feature / integration | 10/10 | P1 AI SALES: outbound message policy, contact suppression and conversion attribution |
| [#335](https://github.com/Masterleeaus/Supercharged/issues/335) | Feature / integration | 10/10 | P1 AI: business-specific RAG onboarding, multilingual accuracy and response governance |
| [#334](https://github.com/Masterleeaus/Supercharged/issues/334) | Feature / integration | 11/11 | P0 AGENT TEAM: signed booking tools with deterministic Scheduling & Enquiries Manager authority |
| [#333](https://github.com/Masterleeaus/Supercharged/issues/333) | Feature / integration | 10/10 | P0 AGENT TEAM: hosted voice calls, escalation and failover (single-plugin boundary) |
| [#330](https://github.com/Masterleeaus/Supercharged/issues/330) | Feature / integration | 8/8 | P1 AGENT TEAM: consent-safe missed-call recovery, quotes and follow-up |
| [#329](https://github.com/Masterleeaus/Supercharged/issues/329) | Feature / integration | 9/9 | P1 AI ASSISTANT: shared multilingual knowledge-grounded conversations (no duplicate chatbot) |
| [#328](https://github.com/Masterleeaus/Supercharged/issues/328) | Feature / integration | 8/8 | P0 AGENT TEAM: signed telephony events, consent and secure handoff for Scheduling & Enquiries Manager |
| [#325](https://github.com/Masterleeaus/Supercharged/issues/325) | Feature / integration | 5/5 | P0 AGENT TEAM: hosted voice receptionist, lead capture and missed-call recovery |
| [#324](https://github.com/Masterleeaus/Supercharged/issues/324) | Defect / verification | 5/5 | [Scan] Widget config skips domain allowlist when Origin and Referer are absent |
| [#323](https://github.com/Masterleeaus/Supercharged/issues/323) | Defect / verification | 7/7 | [Scan] rag-knowledge.ts has 10 strict-mode errors on untyped catch variables |
| [#322](https://github.com/Masterleeaus/Supercharged/issues/322) | Defect / verification | 7/7 | [Scan] searchKnowledge catch-block test pins old `catch (error: any)` text |
| [#321](https://github.com/Masterleeaus/Supercharged/issues/321) | Defect / verification | 9/9 | [Scan] plugin-loader-policy tests pin a removed `as any` fragment (3 failures) |
| [#320](https://github.com/Masterleeaus/Supercharged/issues/320) | Defect / verification | 5/5 | [Scan] route-auth coverage test fails: 139 routes missing from allowlist |
| [#319](https://github.com/Masterleeaus/Supercharged/issues/319) | Defect / verification | 5/5 | [Scan] Plivo voice webhooks shadowed by /api/plivo/voice/:callId route |
| [#318](https://github.com/Masterleeaus/Supercharged/issues/318) | Feature / integration | 6/6 | [P1] Finish AI agent, inbox, chatbot, campaign and approval runtime before go-live |
| [#317](https://github.com/Masterleeaus/Supercharged/issues/317) | Defect / verification | 5/5 | [P0] Reconcile conflicting Supercharged PRs and finish required CI/typecheck gates |
| [#315](https://github.com/Masterleeaus/Supercharged/issues/315) | Cross-product contract | 8/8 | [P0] Deliver tenant-safe cross-app communications and AI actions for Scheduled and Sorted |
| [#254](https://github.com/Masterleeaus/Supercharged/issues/254) | Defect / verification | 10/10 | Two-company tenant-isolation and drift tests on disposable PostgreSQL (Part of #51) |
| [#253](https://github.com/Masterleeaus/Supercharged/issues/253) | Feature / integration | 10/10 | Move schema changes into Central migration chain and block app-local schema drift (Part of #51) |
| [#252](https://github.com/Masterleeaus/Supercharged/issues/252) | Cross-product contract | 10/10 | withTenant() as enforced DB boundary and company-scoped store/query code (Part of #51) |
| [#251](https://github.com/Masterleeaus/Supercharged/issues/251) | Cross-product contract | 10/10 | Additive reversible migrations adding company_id, FKs, indexes and RLS (Part of #51) |
| [#250](https://github.com/Masterleeaus/Supercharged/issues/250) | Cross-product contract | 10/10 | company_id schema design and table registry (Part of #51) |
| [#197](https://github.com/Masterleeaus/Supercharged/issues/197) | Cross-product contract | 6/6 | [P0] Verify AI Workforce shared PostgreSQL, tenant boundaries and Central integration |
| [#196](https://github.com/Masterleeaus/Supercharged/issues/196) | Cross-product contract | 3/3 | Central integration: consume feature flags and signed outbox events |
| [#195](https://github.com/Masterleeaus/Supercharged/issues/195) | Cross-product contract | 3/3 | Central integration: tenant model, memberships and the company column |
| [#194](https://github.com/Masterleeaus/Supercharged/issues/194) | Cross-product contract | 4/4 | Central integration: service calls with client credentials and product audience |
| [#192](https://github.com/Masterleeaus/Supercharged/issues/192) | Cross-product contract | 4/4 | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) |
| [#176](https://github.com/Masterleeaus/Supercharged/issues/176) | Curriculum / content | 6/6 | [Vertical 40/50] Mobile beauty |
| [#175](https://github.com/Masterleeaus/Supercharged/issues/175) | Curriculum / content | 6/6 | [Vertical 39/50] Mobile hairdressing and barbering |
| [#173](https://github.com/Masterleeaus/Supercharged/issues/173) | Curriculum / content | 6/6 | [Vertical 37/50] Pet grooming |
| [#172](https://github.com/Masterleeaus/Supercharged/issues/172) | Curriculum / content | 6/6 | [Vertical 36/50] Pet and house sitting |
| [#171](https://github.com/Masterleeaus/Supercharged/issues/171) | Curriculum / content | 6/6 | [Vertical 35/50] Dog walking |
| [#170](https://github.com/Masterleeaus/Supercharged/issues/170) | Curriculum / content | 6/6 | [Vertical 34/50] Aquarium maintenance |
| [#168](https://github.com/Masterleeaus/Supercharged/issues/168) | Curriculum / content | 6/6 | [Vertical 32/50] Pond and water-feature maintenance |
| [#133](https://github.com/Masterleeaus/Supercharged/issues/133) | Product implementation | 10/10 | Remove committed archives and logs; add ignore rules; check for secrets first |
| [#129](https://github.com/Masterleeaus/Supercharged/issues/129) | Product implementation | 4/4 | [Client] Break up the largest pages and admin panels |
| [#127](https://github.com/Masterleeaus/Supercharged/issues/127) | Cross-product contract | 4/4 | [Tenancy] Extend tenant-isolation checks to every module |
| [#122](https://github.com/Masterleeaus/Supercharged/issues/122) | Defect / verification | 4/4 | [CI] Make the Typecheck a required check, area by area |
| [#54](https://github.com/Masterleeaus/Supercharged/issues/54) | Product implementation | 10/10 | [Brand] Rebrand Supercharged surfaces and consolidate the app source into a cohesive base |
| [#53](https://github.com/Masterleeaus/Supercharged/issues/53) | Product implementation | 13/13 | [Central] Implement and verify Supercharged's Central sign-in adapter |
| [#51](https://github.com/Masterleeaus/Supercharged/issues/51) | Cross-product contract | 10/10 | Move Supercharged onto the shared company_id schema and Central migration chain |
| [#48](https://github.com/Masterleeaus/Supercharged/issues/48) | Feature / integration | 10/10 | [Synced] Make the customer chatbot builder a first-class Synced mode |
| [#26](https://github.com/Masterleeaus/Supercharged/issues/26) | Product implementation | 10/10 | [Chatbot] Owner open items and unverified checks |
| [#24](https://github.com/Masterleeaus/Supercharged/issues/24) | Product implementation | 10/10 | [Chatbot] Background workers and voice call service are not constructed in server/ |
| [#22](https://github.com/Masterleeaus/Supercharged/issues/22) | Product implementation | 5/5 | [Chatbot] Channel and widget reply runtime and receipt store are stubs |
| [#19](https://github.com/Masterleeaus/Supercharged/issues/19) | Product implementation | 4/4 | [Feature] appointment.reminder_sent webhook trigger is not implemented |
| [#17](https://github.com/Masterleeaus/Supercharged/issues/17) | Product implementation | 7/7 | [Upgrade] Split server/routes.ts and flow-automation-routes.ts into smaller modules |
| [#15](https://github.com/Masterleeaus/Supercharged/issues/15) | Product implementation | 5/5 | [Upgrade] About 2,900 uses of `any` in server, shared, and client |
| [#2](https://github.com/Masterleeaus/Supercharged/issues/2) | Defect / verification | 5/5 | [Security] Webhook secret files are committed to git |

### [Central](https://github.com/Masterleeaus/Central/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#168](https://github.com/Masterleeaus/Central/issues/168) | Legacy verification | 10/11 | P1 GOVERNANCE: retrospectively verify closed issues missing task checklists across Titan Zero |
| [#167](https://github.com/Masterleeaus/Central/issues/167) | Legacy verification | 37/37 | [Governance] Verify 27 legacy closed issues against task-completion policy |
| [#160](https://github.com/Masterleeaus/Central/issues/160) | Product implementation | 8/8 | P0 RELEASE: cross-product integration staging suite and production go/no-go checklist |
| [#159](https://github.com/Masterleeaus/Central/issues/159) | Feature / integration | 9/9 | P1 WORKFORCE: shared smart task orchestration, pause/approve/retry policies and outcomes |
| [#158](https://github.com/Masterleeaus/Central/issues/158) | Cross-product contract | 9/9 | P1 CROSS-APP: privacy policy, tenant audit, consent ledger and data deletion orchestration |
| [#157](https://github.com/Masterleeaus/Central/issues/157) | Feature / integration | 12/12 | P1 COMMERCE: Scheduling & Enquiries Manager in-plugin hosted AI upgrades |
| [#156](https://github.com/Masterleeaus/Central/issues/156) | Feature / integration | 7/7 | P0 CATALOG: Scheduling & Enquiries Manager — Free / Assistant / Agent Team entitlements |
| [#154](https://github.com/Masterleeaus/Central/issues/154) | Feature / integration | 9/9 | P1 Front Desk hosted AI execution receipts, cost observability and abuse controls |
| [#153](https://github.com/Masterleeaus/Central/issues/153) | Feature / integration | 10/10 | P0: Scheduling & Enquiries Manager — Assistant and Agent Team subscription billing |
| [#152](https://github.com/Masterleeaus/Central/issues/152) | Feature / integration | 11/11 | P0 Front Desk WordPress site and company pairing: secure delegated permissions |
| [#151](https://github.com/Masterleeaus/Central/issues/151) | Defect / verification | 4/4 | CI workflow hard-codes the database password in 35 places |
| [#149](https://github.com/Masterleeaus/Central/issues/149) | Epic / integration parent | 9/9 | EPIC Front Desk one-plugin hosted AI: identity, Assistant/Agent Team entitlements and receipts |
| [#147](https://github.com/Masterleeaus/Central/issues/147) | Defect / verification | 5/5 | [Scan] Stale expected-fail markers hide passing Scheduled conformance checks |
| [#146](https://github.com/Masterleeaus/Central/issues/146) | Defect / verification | 6/6 | [Scan] Central accepts stale and future-dated Scheduled envelopes |
| [#145](https://github.com/Masterleeaus/Central/issues/145) | Defect / verification | 5/5 | [Scan] Nine PostgreSQL feature-flag tests skip in every CI run |
| [#144](https://github.com/Masterleeaus/Central/issues/144) | Defect / verification | 7/7 | [Scan] CI never runs the Scheduled conformance suite that root npm test includes |
| [#142](https://github.com/Masterleeaus/Central/issues/142) | Product implementation | 6/6 | [P1] Production operations and release readiness matrix for the five-app integrated platform |
| [#141](https://github.com/Masterleeaus/Central/issues/141) | Product implementation | 6/6 | [P0] Prove Central login is the only unified-mode login across all five products |
| [#140](https://github.com/Masterleeaus/Central/issues/140) | Cross-product contract | 7/7 | [P0][Five-app] Enforce one physical PostgreSQL database with per-product schemas and one migration ledger |
| [#107](https://github.com/Masterleeaus/Central/issues/107) | Product implementation | 4/4 | Finish and merge feat/decision-expiry-5min so service decisions carry expiresAt |
| [#106](https://github.com/Masterleeaus/Central/issues/106) | Product implementation | 5/5 | Set hostnames, DNS and TLS for each product |
| [#105](https://github.com/Masterleeaus/Central/issues/105) | Defect / verification | 4/4 | Publish versioned Central contract test vectors for product CI |
| [#104](https://github.com/Masterleeaus/Central/issues/104) | Product implementation | 5/5 | Map per-product entitlement keys to Central subscription entitlements |
| [#103](https://github.com/Masterleeaus/Central/issues/103) | Cross-product contract | 5/5 | Define cross-product data contracts for shared customers, jobs, bookings and learner records |
| [#102](https://github.com/Masterleeaus/Central/issues/102) | Product implementation | 4/4 | Propagate session revocation and global logout to every product |
| [#101](https://github.com/Masterleeaus/Central/issues/101) | Product implementation | 5/5 | Define onboarding and rotation of product link-assertion public keys |
| [#100](https://github.com/Masterleeaus/Central/issues/100) | Product implementation | 3/5 | Add Scheduled to the Central product registry, audience and operator config |
| [#99](https://github.com/Masterleeaus/Central/issues/99) | Product implementation | 4/4 | Provision Logto machine-to-machine clients for each product service token |
| [#98](https://github.com/Masterleeaus/Central/issues/98) | Cross-product contract | 5/5 | Provision Logto OIDC applications for Sorted, Supercharged, LMS and Scheduled |
| [#95](https://github.com/Masterleeaus/Central/issues/95) | Epic / integration parent | 33/33 | Upgrade plan: Central |
| [#83](https://github.com/Masterleeaus/Central/issues/83) | Cross-product contract | 28/31 | [P0] Define and verify unified + standalone deployment contracts for all five Titan products |
| [#82](https://github.com/Masterleeaus/Central/issues/82) | Cross-product contract | 6/6 | [P0] Cross-repository shared PostgreSQL integration acceptance gate |
| [#74](https://github.com/Masterleeaus/Central/issues/74) | Product implementation | 5/5 | Deployment checks for the public proxy: block /metrics, /internal/ and /v1/admin |
| [#72](https://github.com/Masterleeaus/Central/issues/72) | Cross-product contract | 10/10 | Register the launcher OIDC application so sign-in can start |
| [#71](https://github.com/Masterleeaus/Central/issues/71) | Cross-product contract | 8/8 | Align Skilled link-assertion fixtures with the Central link contract |
| [#70](https://github.com/Masterleeaus/Central/issues/70) | Product implementation | 9/9 | Align the Skilled service-decision endpoint (#68) with Skilled's client |
| [#44](https://github.com/Masterleeaus/Central/issues/44) | Product implementation | 10/10 | [Product UI] Build the Titan Central sign-in and product launcher |
| [#43](https://github.com/Masterleeaus/Central/issues/43) | Product implementation | 13/13 | Define the single Titan database, canonical company boundary, and migration registry |
| [#41](https://github.com/Masterleeaus/Central/issues/41) | Feature / integration | 8/8 | [High] Create a guided customer onboarding and product provisioning workflow |
| [#40](https://github.com/Masterleeaus/Central/issues/40) | Product implementation | 8/8 | [High] Add a durable event and workflow mechanism for cross-product handoffs |
| [#39](https://github.com/Masterleeaus/Central/issues/39) | Product implementation | 8/8 | [Medium] Build a role-scoped support and operations console |
| [#38](https://github.com/Masterleeaus/Central/issues/38) | Product implementation | 8/8 | [Medium] Add centrally governed configuration and gradual feature rollouts |
| [#37](https://github.com/Masterleeaus/Central/issues/37) | Product implementation | 7/7 | [High] Build a verified account-linking workflow for connected products |
| [#36](https://github.com/Masterleeaus/Central/issues/36) | Product implementation | 8/8 | [Medium] Provide a unified, privacy-conscious activity and audit history |
| [#35](https://github.com/Masterleeaus/Central/issues/35) | Product implementation | 7/7 | [High] Connect subscription lifecycle to product entitlements |
| [#34](https://github.com/Masterleeaus/Central/issues/34) | Product implementation | 8/8 | [High] Add central organisation and user administration across connected products |
| [#32](https://github.com/Masterleeaus/Central/issues/32) | Product implementation | 4/4 | [Medium] Add a safe organisation-selection flow for multi-organisation users |
| [#29](https://github.com/Masterleeaus/Central/issues/29) | Cross-product contract | 8/8 | [High] Add Central integration contracts for Sorted, Supercharged and LMS repositories |
| [#28](https://github.com/Masterleeaus/Central/issues/28) | Epic / integration parent | 28/28 | Epic: Titan Central as the main entry and auth for Sorted, Supercharged and LMS |
| [#27](https://github.com/Masterleeaus/Central/issues/27) | Feature / integration | 4/4 | [Medium] LMS app, domain and adapter are not implemented |
| [#26](https://github.com/Masterleeaus/Central/issues/26) | Product implementation | 4/4 | [High] Sorted session adapter and account mapping are not implemented |
| [#25](https://github.com/Masterleeaus/Central/issues/25) | Product implementation | 4/4 | [High] Supercharged session adapter and account mapping are not implemented |
| [#24](https://github.com/Masterleeaus/Central/issues/24) | Product implementation | 6/6 | [High] Upstream Logto is not vendored, pinned or verified here |
| [#16](https://github.com/Masterleeaus/Central/issues/16) | Feature / integration | 7/7 | [Medium] No audit trail for access decisions and thin observability |
| [#6](https://github.com/Masterleeaus/Central/issues/6) | Product implementation | 6/6 | [High] Global logout is not implemented |

### [Titan-Zero-Trades-Front-Desk](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#49](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/49) | Product implementation | 102/104 | P0: Scheduling & Enquiries Manager — migrate former Pro features into one plugin |
| [#48](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/48) | Feature / integration | 16/16 | P0: Scheduling & Enquiries Manager — specialist AI Agent Team |
| [#47](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/47) | Feature / integration | 17/17 | P0: Scheduling & Enquiries Manager — full hosted AI Assistant |
| [#46](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/46) | Feature / integration | 23/23 | P0: Scheduling & Enquiries Manager — in-dashboard AI services upgrade, billing and downgrade |
| [#45](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/45) | Epic / integration parent | 17/17 | EPIC P0: Scheduling & Enquiries Manager — one WordPress plugin, Free → AI Assistant → AI Agent Team |
| [#44](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/44) | Defect / verification | 19/19 | P0 FREE AI RELEASE: security, WordPress.org serviceware compliance and pilot cost verification |
| [#43](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/43) | Feature / integration | 6/6 | P0 FREE AI FOUNDATION: optional proxy connection, consent, budgets, embeddings and inference observability |
| [#42](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/42) | Cross-product contract | 15/15 | P0 FREE AI FOUNDATION: deterministic intent engine, tenant FAQ store, exact/semantic cache and invalidation |
| [#41](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/41) | Feature / integration | 10/10 | P1 FREE AI 22: Monthly AI Insights Summary |
| [#40](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/40) | Feature / integration | 11/11 | P1 FREE AI 21: AI-Guided Plugin Setup |
| [#39](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/39) | Feature / integration | 10/10 | P0 FREE AI 20: AI Knowledge Builder & Editor |
| [#38](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/38) | Feature / integration | 10/10 | P1 FREE AI 19: Customer Conversation Summaries |
| [#37](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/37) | Feature / integration | 10/10 | P1 FREE AI 18: Smart Reply Drafts |
| [#36](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/36) | Feature / integration | 10/10 | P0 FREE AI 17: FAQ Knowledge Gap Detection |
| [#35](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/35) | Feature / integration | 9/9 | P0 FREE AI 16: Weekly AI FAQ Suggestions |
| [#34](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/34) | Feature / integration | 11/11 | P0 FREE AI 15: Spam & Duplicate Enquiry Detection |
| [#33](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/33) | Feature / integration | 10/10 | P1 FREE AI 14: Follow-Up Suggestions |
| [#32](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/32) | Feature / integration | 9/9 | P0 FREE AI 13: Quote Request Classification |
| [#31](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/31) | Feature / integration | 14/14 | P1 FREE AI 12: Missed-Call Reply Intelligence |
| [#30](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/30) | Feature / integration | 10/10 | P0 FREE AI 11: Missed-Call Recognition & Callback Tasks |
| [#29](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/29) | Feature / integration | 10/10 | P0 FREE AI 10: Lead Urgency Detection |
| [#28](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/28) | Feature / integration | 7/7 | P0 FREE AI 09: Deterministic Enquiry Triage |
| [#27](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/27) | Feature / integration | 7/7 | P0 FREE AI 08: Human Handoff & Escalation |
| [#26](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/26) | Feature / integration | 8/8 | P1 FREE AI 07: Basic Multilingual Assistance |
| [#25](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/25) | Feature / integration | 7/7 | P0 FREE AI 06: Cancellation & Rescheduling Assistant |
| [#24](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/24) | Feature / integration | 7/7 | P0 FREE AI 05: Guided Booking Assistant |
| [#23](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/23) | Feature / integration | 7/7 | P0 FREE AI 04: Smart Service Finder |
| [#22](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/22) | Feature / integration | 8/8 | P0 FREE AI 03: Business Knowledge Assistant |
| [#21](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/21) | Feature / integration | 14/14 | P0 FREE AI 02: Semantic FAQ Search |
| [#20](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/20) | Feature / integration | 15/15 | P0 FREE AI 01: AI Answer Box |
| [#19](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/19) | Epic / integration parent | 25/25 | EPIC P0: Make Front Desk Free genuinely AI-powered — 22 features, optional proxy, limits, safe fallback |
| [#17](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/17) | Defect / verification | 10/10 | P0 FREE: consent-driven legacy AI data/config migration and rollback UI |
| [#16](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/16) | Cross-product contract | 8/8 | P0: versioned one-plugin local-to-hosted service contracts and tool permissions |
| [#15](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/15) | Product implementation | 11/11 | P2 PLUGIN: onboarding, admin setup and contextual upgrade conversion without dark patterns |
| [#14](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/14) | Feature / integration | 5/5 | P1 AGENT: front-desk delegated tool permissions and action receipt viewer |
| [#12](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/12) | Feature / integration | 5/5 | P1 LOCAL: advanced reports, exports and customer segmentation in one plugin |
| [#11](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/11) | Product implementation | 5/5 | P1 LOCAL: multi-location, staff and advanced service policy workflows in one plugin |
| [#9](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/9) | Product implementation | 5/5 | P0 PLUGIN: final free plugin packaging, accessibility, i18n, updates and WordPress.org readme |
| [#8](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/8) | Defect / verification | 8/8 | P0 PLUGIN: harden booking security, REST/AJAX authorization and privacy consent |
| [#7](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/7) | Defect / verification | 10/10 | P0 PLUGIN: end-to-end booking runtime tests, activation, upgrade and rollback |
| [#6](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/6) | Product implementation | 10/10 | P0 PLUGIN: reproduce current source, compare cumulative Pass 03 and prevent lost upgrades |
| [#4](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/4) | Feature / integration | 5/5 | P1: one Free plugin signed AI service connector for Free / Assistant / Agent Team |
| [#3](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/3) | Defect / verification | 8/8 | P0 Front Desk WordPress.org submission gate: licensing, security, compatibility and reproducible package |
| [#2](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/2) | Feature / integration | 10/10 | P0 Front Desk free edition: eliminate AI execution paths without breaking bookings |

### [Titan-zero-website](https://github.com/Masterleeaus/Titan-zero-website/issues)

| Issue | Workstream | Unchecked / total | Title |
|---|---|---:|---|
| [#52](https://github.com/Masterleeaus/Titan-zero-website/issues/52) | Legacy verification | 8/9 | [Governance] Verify 1 legacy closed issues against task-completion policy |
| [#46](https://github.com/Masterleeaus/Titan-zero-website/issues/46) | Defect / verification | 8/8 | P0 TOOLS RELEASE: source/published parity, accessibility, formula tests and publishing CI |
| [#45](https://github.com/Masterleeaus/Titan-zero-website/issues/45) | Feature / integration | 8/8 | P1 TOOLS SITE: redesign 19-tool directory with categories, search and contextual product journeys |
| [#44](https://github.com/Masterleeaus/Titan-zero-website/issues/44) | Feature / integration | 7/7 | P1 TOOLS PLATFORM: connect calculator results, scenarios and local profiles safely |
| [#43](https://github.com/Masterleeaus/Titan-zero-website/issues/43) | Feature / integration | 9/9 | P0 TOOLS PLATFORM: protect private calculation data in sharing, storage and handoffs |
| [#42](https://github.com/Masterleeaus/Titan-zero-website/issues/42) | Defect / verification | 9/9 | P0 TOOLS PLATFORM: testable shared calculation engine, input validation and currency precision |
| [#41](https://github.com/Masterleeaus/Titan-zero-website/issues/41) | Feature / integration | 9/9 | P1 TOOLS NEW: six-optional-upgrade cost and scenario configurator |
| [#40](https://github.com/Masterleeaus/Titan-zero-website/issues/40) | Feature / integration | 8/8 | P1 TOOLS NEW: customer response and follow-up planner |
| [#39](https://github.com/Masterleeaus/Titan-zero-website/issues/39) | Feature / integration | 7/7 | P1 TOOLS NEW: staff utilisation and training planner |
| [#38](https://github.com/Masterleeaus/Titan-zero-website/issues/38) | Feature / integration | 8/8 | P1 TOOLS NEW: thirteen-week business cash-flow forecast |
| [#37](https://github.com/Masterleeaus/Titan-zero-website/issues/37) | Feature / integration | 8/8 | P1 TOOLS NEW: recurring service revenue and retention calculator |
| [#36](https://github.com/Masterleeaus/Titan-zero-website/issues/36) | Feature / integration | 7/7 | P1 TOOLS NEW: travel and route cost calculator |
| [#35](https://github.com/Masterleeaus/Titan-zero-website/issues/35) | Feature / integration | 7/7 | P0 TOOLS NEW: booking revenue, cancellation and no-show planner |
| [#34](https://github.com/Masterleeaus/Titan-zero-website/issues/34) | Feature / integration | 8/8 | P0 TOOLS NEW: service pricing and minimum viable quote calculator |
| [#33](https://github.com/Masterleeaus/Titan-zero-website/issues/33) | Feature / integration | 7/7 | P0 TOOLS: checklist generator — preserve completion state and reusable templates |
| [#32](https://github.com/Masterleeaus/Titan-zero-website/issues/32) | Feature / integration | 7/7 | P1 TOOLS: job-cost sheet — detailed cost categories and traceable estimates |
| [#31](https://github.com/Masterleeaus/Titan-zero-website/issues/31) | Feature / integration | 8/8 | P0 TOOLS: quote builder — persistence, professional documents and tax correctness |
| [#30](https://github.com/Masterleeaus/Titan-zero-website/issues/30) | Feature / integration | 6/6 | P1 TOOLS: invoice collection — receivables ageing and 13-week cash timing |
| [#29](https://github.com/Masterleeaus/Titan-zero-website/issues/29) | Feature / integration | 6/6 | P1 TOOLS: lead-conversion calculator — stage funnel and contribution change |
| [#28](https://github.com/Masterleeaus/Titan-zero-website/issues/28) | Feature / integration | 7/7 | P1 TOOLS: missed-enquiry calculator — realistic recovery and contribution scenarios |
| [#27](https://github.com/Masterleeaus/Titan-zero-website/issues/27) | Feature / integration | 10/10 | P1 TOOLS: capacity planner — travel, leave, durations and service constraints |
| [#26](https://github.com/Masterleeaus/Titan-zero-website/issues/26) | Feature / integration | 10/10 | P1 TOOLS: job-profitability calculator — contribution, net profit and margin/markup clarity |
| [#25](https://github.com/Masterleeaus/Titan-zero-website/issues/25) | Cross-product contract | 9/9 | P1 TOOLS: hiring-cost calculator — roster, on-cost and contractor scenarios |
| [#24](https://github.com/Masterleeaus/Titan-zero-website/issues/24) | Feature / integration | 9/9 | P1 TOOLS: admin-cost calculator — recoverable time versus actual savings |
| [#23](https://github.com/Masterleeaus/Titan-zero-website/issues/23) | Feature / integration | 4/7 | P0 TOOLS: correct break-even no-contribution result and invalid financial states |
| [#22](https://github.com/Masterleeaus/Titan-zero-website/issues/22) | Epic / integration parent | 10/10 | EPIC: upgrade 11 existing tools and deliver a connected 19-tool Titan Zero business suite |
| [#21](https://github.com/Masterleeaus/Titan-zero-website/issues/21) | Defect / verification | 10/10 | P0 WEBSITE: static generation source-of-truth and CI drift/link/accessibility gate |
| [#20](https://github.com/Masterleeaus/Titan-zero-website/issues/20) | Feature / integration | 10/10 | P1 WEBSITE: reconcile Free plugin acquisition vs Titan BOS free core in all copy and metadata |
| [#19](https://github.com/Masterleeaus/Titan-zero-website/issues/19) | Feature / integration | 13/13 | P0 WEBSITE: correct Front Desk SEO hierarchy, breadcrumb parent and global navigation across published pages |
| [#18](https://github.com/Masterleeaus/Titan-zero-website/issues/18) | Feature / integration | 9/9 | P1 WEBSITE: reciprocal Front Desk integration sections on four At.Work application pages |
| [#17](https://github.com/Masterleeaus/Titan-zero-website/issues/17) | Feature / integration | 10/10 | P0 WEBSITE: Scheduling & Enquiries Manager in-plugin AI service upgrade selector |
| [#16](https://github.com/Masterleeaus/Titan-zero-website/issues/16) | Feature / integration | 10/10 | P0 WEBSITE: connected apps & six upgrades without Pro plugin |
| [#15](https://github.com/Masterleeaus/Titan-zero-website/issues/15) | Feature / integration | 10/10 | P0 WEBSITE: Scheduling & Enquiries Manager six-upgrade catalogue |
| [#14](https://github.com/Masterleeaus/Titan-zero-website/issues/14) | Feature / integration | 8/8 | P1 WEBSITE: Front Desk integration documentation, product support and service status pages |
| [#11](https://github.com/Masterleeaus/Titan-zero-website/issues/11) | Feature / integration | 10/10 | P0 WEBSITE: Scheduling & Enquiries Manager product hub and hosted AI upgrades |
| [#9](https://github.com/Masterleeaus/Titan-zero-website/issues/9) | Epic / integration parent | 8/8 | EPIC WEBSITE: Scheduling & Enquiries Manager — Free, AI Assistant and AI Agent Team |
| [#8](https://github.com/Masterleeaus/Titan-zero-website/issues/8) | Feature / integration | 6/6 | P1 WEBSITE: front desk industry-specific conversion sections and FAQs |
| [#7](https://github.com/Masterleeaus/Titan-zero-website/issues/7) | Feature / integration | 8/8 | P1 WEBSITE: conversion tracking, SEO, legal and static site release verification |
| [#6](https://github.com/Masterleeaus/Titan-zero-website/issues/6) | Feature / integration | 8/8 | P1 WEBSITE: Front Desk product screenshots, illustration assets and design QA |
| [#5](https://github.com/Masterleeaus/Titan-zero-website/issues/5) | Feature / integration | 6/6 | P1 WEBSITE: Scheduling & Enquiries Manager — Free / Assistant / Agent Team pricing |
| [#4](https://github.com/Masterleeaus/Titan-zero-website/issues/4) | Feature / integration | 11/11 | P0 WEBSITE: Free + Assistant + Agent Team navigation, footer and sitemap |
| [#3](https://github.com/Masterleeaus/Titan-zero-website/issues/3) | Feature / integration | 8/8 | P0 WEBSITE: AI Agent Team for autonomous enquiries and bookings — no extra WP plugin |
| [#2](https://github.com/Masterleeaus/Titan-zero-website/issues/2) | Feature / integration | 8/8 | P0 WEBSITE: full hosted AI Assistant page (upgrade inside Free WordPress plugin) |
| [#1](https://github.com/Masterleeaus/Titan-zero-website/issues/1) | Feature / integration | 10/10 | P0 WEBSITE: retire Pro offer and preserve /frontdeskpro/ SEO route |

## Closure and merge verification policy
1. Confirm the current architecture and check full issue body and linked code/PRs.
2. If a duplicate, copy **all unique outstanding requirements** to the canonical issue as unchecked checkboxes, link both, then close the duplicate with the proper reason.
3. If only a superseded architecture decision, document source proof, keep implementation acceptance open elsewhere, and close only the decision/obsolete package.
4. A real defect is closed only after merged source, passing CI and its specific runtime acceptance. Do not tick or close partial delivery.
5. Staging production claims require live integration checks, security, tenant isolation, consent and rollback evidence; repo README or a pass report alone is insufficient.

Reference architecture: [Central ADR-009](https://github.com/Masterleeaus/Central/blob/main/TITAN_ARCHITECTURE_DECISIONS.md), [Central product registry](https://github.com/Masterleeaus/Central/blob/main/docs/PRODUCT_REGISTRY.md), [Front Desk canonical architecture](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/docs/SINGLE-PLUGIN-AI-SERVICES-ARCHITECTURE.md).
