# Titan Zero seven-core GitHub issue / architecture triage

**Audit date:** 2026-11-15. **Strict scope:** only the seven repositories below; the historical Front Desk Pro repository and all other repositories are excluded.

This is an **issue inventory and planning/evidence audit**, not a full runtime/code certification. Task counts refer to Markdown checkbox lines in the GitHub issue bodies when searched. Concurrent edits can change counts. Existing unchecked implementation work must not be reported as complete due to moving or closing a duplicate planning issue.

## Canonical ownership and architectural invariants

| Owner repository | Canonical responsibility |
|---|---|
| [Central](https://github.com/Masterleeaus/Central) | Central/Logto identity, company UUIDs, entitlements, shared schema/migration coordination, unified/standalone deployment contracts |
| [Scheduled](https://github.com/Masterleeaus/Scheduled) | One in-process Laravel PlusAgency+Cleanto application, booking/calendar source of truth in integrated mode, availability/atomic booking, no Cleanto sidecar |
| [Sorted](https://github.com/Masterleeaus/Sorted) | Job and work-order lifecycle, quotes, invoices, field operations; consumes approved booking events |
| [Skilled](https://github.com/Masterleeaus/Skilled) | Published training, assessor-approved competency status and consented coaching; no AI-generated certification |
| [Supercharged](https://github.com/Masterleeaus/Supercharged) | Customer communications, hosted AI/Agent Team workflows, voice adapters and governed action requests; never independent booking write authority |
| [Scheduling & Enquiries Manager](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk) | One installed, standalone-capable WordPress Free plugin; optional hosted Assistant and Agent Team within it, no extra Pro plugin |
| [Titan Zero Website](https://github.com/Masterleeaus/Titan-zero-website) | Static marketing/SEO, truthful product and six optional-upgrade catalogue, calculators and public tools; no invented checkout or release status |

**Integrated five-app target:** Central, Scheduled, Sorted, Skilled and Supercharged use one physical PostgreSQL database and one Central-managed migration ledger, with least-privilege per-app connections. In separately deployed/standalone mode, a product must not need sibling apps to boot, per Central #83. The WordPress plugin and website are not extra app database owners. For disconnected WordPress sites, the plugin's local booking engine remains usable; for connected business workflows, exactly one booking authority per business is required, with Scheduled the integrated owner. Status is target/contract, not deployment certification.

## Already consolidated or administratively retired (no feature-completion claims)

| Repo | Retired tracker(s) | Surviving issue(s) | Reason |
|---|---|---|---|
| Titan-Zero-Trades-Front-Desk | [#1](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/1), [#5](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/5), [#10](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/10) | #45, #49, #16 | Duplicate/superseded old epics and Pro add-on |
| Titan-zero-website | [#12](https://github.com/Masterleeaus/Titan-zero-website/issues/12), [#13](https://github.com/Masterleeaus/Titan-zero-website/issues/13) | #4, #19, #11, #1, #14 | Duplicate navigation and retired Pro download |
| Skilled | [#306](https://github.com/Masterleeaus/Skilled/issues/306), [#307](https://github.com/Masterleeaus/Skilled/issues/307), [#308](https://github.com/Masterleeaus/Skilled/issues/308) | #310, #311, #312 | Three superseded knowledge, competency and coaching implementations |
| Central | [#161](https://github.com/Masterleeaus/Central/issues/161) | #152, #153, #156, #157 | Retired separate Pro ZIP fulfilment |

## Reviewed overlap clusters (do not bulk-close parent/child requirements)

| Repo | Disposition | Evidence-based rationale |
|---|---|---|
| Scheduled | Keep distinct | Parent #56 delegates to #58 (atomic booking), #59 (reconciliation), #62 (service mapping), #67 (release contract tests). #60 builds optimizer; #63 adds recurring/route evaluation. |
| Sorted | Keep distinct | Parent #99 delegates to #102/86 (lead-to-job authority), #106/103 (quote contract/estimator), #108 (approval UI), #109 (invoice payments). Avoid duplicated customer IDs. |
| Skilled | Consolidated | Retired #306→#310, #307→#311, #308→#312 with unique acceptance copied as unchecked tasks. Parent #304 stays open; #313/314 cover onboarding and single-plugin display. |
| Supercharged | Keep distinct | Parent #325 delegates to #328 (provider events), #333 (voice sessions), #334 (booking tool authority), #338 (sandbox E2E). #329 conversational runtime versus #335 knowledge quality; #330 follow-up operations versus #336 suppression policy. |
| Central | Keep distinct | Original #28 tracks foundational access/security, #83 dual-mode acceptance, #43 company/migration registry, #140 five-product physical DB, #160 go/no-go; #167 is Central legacy audit and #168 cross-repo audit. |
| Titan-Zero-Trades-Front-Desk | Consolidated | Retired #1→#45, old Pro local #5→#49, independent Pro API #10→#16/#49. #19 Free AI sub-epic is distinct from #45 product epic; #13 local settings UI is distinct from #46 service/billing. |
| Titan-zero-website | Consolidated | Retired duplicate hub/navigation #12→#4/#19/#11, retired Pro download #13→#1/#14/#11. #4 navigation, #19 SEO, #11 product hub and #15/16 upgrade catalogue/presentation remain distinct; #22 groups calculator work. |

## High-priority release and security blockers that must remain unchecked until tested

- **Scheduled:** #54 committed PayUmoney installer salt and rotation, #55 PHP namespace parse failures, #50 fresh migrations, #46 integrated Laravel/booking runtime, #47 end-to-end booking/checkout, #15/#49 PostgreSQL.
- **Sorted:** #100 migration collision 209/210, #98 unsafe/non-reversible migration history, #97 manifest drift, #95 audit table mismatch, #88 CI/PR reconciliation, #86 cross-app lifecycle.
- **Skilled:** #301 unauthenticated meeting/recording URLs, #300 discussion access controls, #302 migrations rollback, #299 review/merge PRs, #9 browser/learner/assessor E2E.
- **Supercharged:** #343 secret-in-URL design, #2 historic webhook secret rotation, #324 widget allowlist bypass, #320 route auth coverage, #319 Plivo callback runtime acceptance, #317 CI and #338 voice→booking E2E.
- **Central:** #151 plaintext CI database password usage, #145 skipped feature flag tests, #146 stale event envelope rejection, #140 shared DB migration, #141 SSO-only integrated login, #160 release gate.
- **Front Desk:** #8 REST/AJAX authorization, #7 activation/install/booking runtime E2E, #9 WP.org package, #2 consented legacy AI migration, #17 rollback, #45–#49 single-plugin release.
- **Website:** #21 published/source parity, #4/#19 truthful navigation/SEO, #15/#16 six optional upgrades, #42 calculation integrity, #43 privacy and #46 static release suite.

## Complete open-issue inventory snapshot

**Disposition legend:** “Keep / implement” means do not merge without verified equivalence; “Keep / parent” means the issue tracks child deliverables; “Security / test” requires code evidence before closure; “Architecture / aligned” means the issue text has been reconciled or ownership identified, **not** that implementation is done. “Governance” tracks historical evidence.

### Scheduled

**Open:** 29; **task checkboxes:** 198; **checked:** 13; **missing checklist:** 0; **historically closed:** 1, including 0 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#76](https://github.com/Masterleeaus/Scheduled/issues/76) | [P1 Scan] Remove or secure orphan public /backup route referencing missing controller method | 3/9 | Keep: distinct implementation |
| [#67](https://github.com/Masterleeaus/Scheduled/issues/67) | P0 FRONT DESK: certify one-plugin booking contracts (Free / hosted Assistant / Agent Team) | 0/9 | Keep: one-plugin contract certification |
| [#65](https://github.com/Masterleeaus/Scheduled/issues/65) | P1 OPERATIONS: booking recovery dashboards, queue observability and provider health | 0/7 | Keep: distinct implementation |
| [#64](https://github.com/Masterleeaus/Scheduled/issues/64) | P1 BOOKING COMMERCE: deposits, checkout state, payment callbacks and recovery | 0/7 | Keep: distinct implementation |
| [#63](https://github.com/Masterleeaus/Scheduled/issues/63) | P1 SCHEDULING: recurring service, route grouping and AI scheduling recommendation evaluation | 0/7 | Keep: recurring/route evaluation |
| [#62](https://github.com/Masterleeaus/Scheduled/issues/62) | P0 CONTRACTS: Front Desk service pricing, location, staffing and timezone mapping | 0/7 | Keep: distinct implementation |
| [#60](https://github.com/Masterleeaus/Scheduled/issues/60) | P1 Paid AI scheduling optimisation for home and field services | 0/6 | Keep: optimization algorithm |
| [#59](https://github.com/Masterleeaus/Scheduled/issues/59) | P1 Front Desk cancellations, reschedules, waitlist and event reconciliation | 0/7 | Keep: distinct implementation |
| [#58](https://github.com/Masterleeaus/Scheduled/issues/58) | P0 Front Desk booking source-of-truth contract: availability and atomic commit | 0/8 | Keep: booking authority / atomic commit |
| [#56](https://github.com/Masterleeaus/Scheduled/issues/56) | Front Desk integration: booking availability, holds and transactional synchronisation | 0/11 | Keep: Front Desk adapter parent |
| [#55](https://github.com/Masterleeaus/Scheduled/issues/55) | [Scan] Eight Cleanto API files fail php -l: whitespace in Plivo\ RestAPI namespace | 0/10 | Keep: security/CI implementation |
| [#54](https://github.com/Masterleeaus/Scheduled/issues/54) | [Scan] PayUmoney gateway salt committed in installer/database.sql | 0/5 | Keep: security/CI implementation |
| [#53](https://github.com/Masterleeaus/Scheduled/issues/53) | [Scan] MySQL-only SQL in booking claim ledger and schema readers, not in #15 inventory | 0/10 | Keep: security/CI implementation |
| [#52](https://github.com/Masterleeaus/Scheduled/issues/52) | [Scan] Site template tests expect 10 templates but SiteTemplates::catalog() returns 19 | 0/6 | Keep: security/CI implementation |
| [#51](https://github.com/Masterleeaus/Scheduled/issues/51) | [Scan] CI runs only tests/run.php; 12 other PHP test scripts fail when run directly | 0/10 | Keep: security/CI implementation |
| [#50](https://github.com/Masterleeaus/Scheduled/issues/50) | [Scan] Fresh install fails: two 2026_11_15 migrations missing from InitialFeatureMigrations list | 0/5 | Keep: security/CI implementation |
| [#49](https://github.com/Masterleeaus/Scheduled/issues/49) | [P0] Port installer, preflight, queues and booking persistence to central PostgreSQL and Central OIDC | 0/6 | Keep: distinct implementation |
| [#48](https://github.com/Masterleeaus/Scheduled/issues/48) | [P1] Complete integrated ten-template website and landing-page builder with publishing | 0/6 | Keep: distinct implementation |
| [#47](https://github.com/Masterleeaus/Scheduled/issues/47) | [P0] Finish booking engine end to end: availability, checkout, assignment, payments and recovery | 0/7 | Keep: distinct implementation |
| [#46](https://github.com/Masterleeaus/Scheduled/issues/46) | [P0] Eliminate Cleanto sidecar: one Laravel Scheduled application, runtime and booking authority | 0/7 | Keep: single Laravel booking runtime |
| [#15](https://github.com/Masterleeaus/Scheduled/issues/15) | Migrate Scheduled database from MySQL/MariaDB to PostgreSQL | 0/5 | Keep: distinct implementation |
| [#11](https://github.com/Masterleeaus/Scheduled/issues/11) | Decide Scheduled's ownership boundary with Supercharged appointment features | 5/10 | Reopened: reminder/overlap acceptance outstanding |
| [#10](https://github.com/Masterleeaus/Scheduled/issues/10) | Confirm repository visibility, licence and secret scan before importing source | 4/6 | Keep: distinct implementation |
| [#7](https://github.com/Masterleeaus/Scheduled/issues/7) | [P0] Establish Scheduled source, product contract and shared PostgreSQL integration | 1/8 | Keep: distinct implementation |
| [#6](https://github.com/Masterleeaus/Scheduled/issues/6) | Central integration: consume feature flags and signed outbox events | 0/3 | Keep: distinct implementation |
| [#5](https://github.com/Masterleeaus/Scheduled/issues/5) | Central integration: tenant model, memberships and the company column | 0/6 | Keep: distinct implementation |
| [#4](https://github.com/Masterleeaus/Scheduled/issues/4) | Central integration: service calls with client credentials and product audience | 0/3 | Keep: distinct implementation |
| [#3](https://github.com/Masterleeaus/Scheduled/issues/3) | Central integration: sign-in via Central OIDC (PKCE, per-app audience) | 0/3 | Keep: distinct implementation |
| [#2](https://github.com/Masterleeaus/Scheduled/issues/2) | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) | 0/4 | Keep: distinct implementation |

### Sorted

**Open:** 42; **task checkboxes:** 364; **checked:** 0; **missing checklist:** 0; **historically closed:** 22, including 19 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#115](https://github.com/Masterleeaus/Sorted/issues/115) | [Governance] Verify 19 legacy closed issues against task-completion policy | 0/28 | Keep: historic verification |
| [#110](https://github.com/Masterleeaus/Sorted/issues/110) | P1 CONTRACTS: one-plugin customer/booking/quote/invoice reconciliation for Assistant/Agent Team | 0/8 | Keep: distinct implementation |
| [#109](https://github.com/Masterleeaus/Sorted/issues/109) | P1 REVENUE: invoices, payments, service agreements and recurring job handoff | 0/9 | Keep: distinct implementation |
| [#108](https://github.com/Masterleeaus/Sorted/issues/108) | P1 QUOTES: AI-assisted estimate review UI and conversion to scheduled work | 0/9 | Keep: quote review UI |
| [#107](https://github.com/Masterleeaus/Sorted/issues/107) | P1 FIELD: mobile service job execution, photo evidence and customer-facing status | 0/9 | Keep: distinct implementation |
| [#106](https://github.com/Masterleeaus/Sorted/issues/106) | P0 CONTRACTS: Front Desk estimate and quote request schemas with approved rate cards | 0/9 | Keep: quote contract |
| [#104](https://github.com/Masterleeaus/Sorted/issues/104) | P1 Front Desk service follow-through: field documentation, payment handoff and Smart Task receipts | 0/9 | Keep: distinct implementation |
| [#103](https://github.com/Masterleeaus/Sorted/issues/103) | P1 Paid AI Estimator: photo-based scope and reviewable service quotations | 0/10 | Keep: AI estimation |
| [#102](https://github.com/Masterleeaus/Sorted/issues/102) | P0 Front Desk lead-to-job adapter: tenant-safe customer, booking and work-order synchronisation | 0/9 | Keep: tenant-safe booking-to-job adapter |
| [#100](https://github.com/Masterleeaus/Sorted/issues/100) | main fails the migration prefix guard: 209 and 210 collide | 0/5 | Keep: security/CI implementation |
| [#99](https://github.com/Masterleeaus/Sorted/issues/99) | Front Desk integration: convert enquiries/bookings to jobs and optional quote requests | 0/5 | Keep: parent integration |
| [#98](https://github.com/Masterleeaus/Sorted/issues/98) | [Scan] 218 SQL migrations have no reversal files; some rewrite constraints without a rollback plan | 0/5 | Keep: security/CI implementation |
| [#97](https://github.com/Masterleeaus/Sorted/issues/97) | [Scan] check-titan-manifest reports 4 checksum-drift errors on main and is not run by CI | 0/7 | Keep: security/CI implementation |
| [#96](https://github.com/Masterleeaus/Sorted/issues/96) | [Scan] Walkthrough date test depends on host timezone (passes in UTC, fails in Melbourne) | 0/4 | Keep: security/CI implementation |
| [#95](https://github.com/Masterleeaus/Sorted/issues/95) | [Scan] appendAuditLog writes company_id to audit_log, which has no company_id column | 0/6 | Keep: security/CI implementation |
| [#94](https://github.com/Masterleeaus/Sorted/issues/94) | [Scan] 14 web unit tests expect old navigation labels (Today, Desk, Jobs, Workforce) | 0/7 | Keep: security/CI implementation |
| [#93](https://github.com/Masterleeaus/Sorted/issues/93) | [Scan] titan-builder runtime bridge test fails: expected card, got summary-banner (cause unverified) | 0/4 | Keep: security/CI implementation |
| [#92](https://github.com/Masterleeaus/Sorted/issues/92) | [Scan] Five-tier delegation test expects titan.worker.place_call_agent, which is not in the org graph | 0/4 | Keep: security/CI implementation |
| [#91](https://github.com/Masterleeaus/Sorted/issues/91) | [Scan] titan-platform interface-runtime-native test imports PresentationComposer, which is not defined | 0/4 | Keep: security/CI implementation |
| [#90](https://github.com/Masterleeaus/Sorted/issues/90) | [Scan] titan-platform directadmin-bridge test imports missing apps/directadmin/zero-core/cockpit.mjs | 0/4 | Keep: security/CI implementation |
| [#89](https://github.com/Masterleeaus/Sorted/issues/89) | [Scan] titan-platform tests read missing apps/web builder files (9 test files) | 0/6 | Keep: security/CI implementation |
| [#88](https://github.com/Masterleeaus/Sorted/issues/88) | [P0] Reconcile open overlapping Sorted integration PRs and get CI green on main | 0/5 | Keep: security/CI implementation |
| [#87](https://github.com/Masterleeaus/Sorted/issues/87) | [P1] Verify and finish Sorted operational workflows from quote through invoicing, teams and mobile | 0/6 | Keep: distinct implementation |
| [#86](https://github.com/Masterleeaus/Sorted/issues/86) | [P0] Complete Sorted → Scheduled booking-to-job lifecycle on canonical company_id | 0/6 | Keep: booking-to-job E2E |
| [#44](https://github.com/Masterleeaus/Sorted/issues/44) | Upgrade plan: Sorted | 0/42 | Keep: parent/epic |
| [#42](https://github.com/Masterleeaus/Sorted/issues/42) | [P0] Verify Sorted end-to-end integration against Central and shared PostgreSQL | 0/6 | Keep: distinct implementation |
| [#41](https://github.com/Masterleeaus/Sorted/issues/41) | Central integration: consume feature flags and signed outbox events | 0/4 | Keep: distinct implementation |
| [#40](https://github.com/Masterleeaus/Sorted/issues/40) | Central integration: tenant model, memberships and the company column | 0/3 | Keep: distinct implementation |
| [#39](https://github.com/Masterleeaus/Sorted/issues/39) | Central integration: service calls with client credentials and product audience | 0/4 | Keep: distinct implementation |
| [#37](https://github.com/Masterleeaus/Sorted/issues/37) | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) | 0/9 | Keep: distinct implementation |
| [#35](https://github.com/Masterleeaus/Sorted/issues/35) | Central session adapter and account mapping (Central issue #26) | 0/14 | Keep: distinct implementation |
| [#34](https://github.com/Masterleeaus/Sorted/issues/34) | Remove committed archive and add ignore rules; check it for secrets first | 0/10 | Keep: distinct implementation |
| [#29](https://github.com/Masterleeaus/Sorted/issues/29) | [Brand] Complete the Sorted Field rebrand and preserve Supercharged Desk identity | 0/14 | Keep: distinct implementation |
| [#28](https://github.com/Masterleeaus/Sorted/issues/28) | [Architecture] Integrate Sorted, Supercharged, and LMS on shared identity and company context | 0/13 | Keep: distinct implementation |
| [#27](https://github.com/Masterleeaus/Sorted/issues/27) | [Integration] Connect Supercharged Desk Marketing and Inbox to shared company/customer records | 0/10 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Sorted/issues/26) | Move Sorted onto the shared company_id schema and Central migration chain | 0/10 | Keep: security/CI implementation |
| [#15](https://github.com/Masterleeaus/Sorted/issues/15) | [Database] Reconcile worker RLS policy with cross-account automation sweeps | 0/10 | Keep: distinct implementation |
| [#12](https://github.com/Masterleeaus/Sorted/issues/12) | [Repository policy] Decide the license and distribution boundary for this public codebase | 0/7 | Keep: distinct implementation |
| [#10](https://github.com/Masterleeaus/Sorted/issues/10) | [CI governance] Protect main with the checks documented as required | 0/7 | Keep: security/CI implementation |
| [#6](https://github.com/Masterleeaus/Sorted/issues/6) | [Security] Run the application with a least-privilege database role and enforce tenant isolation | 0/8 | Keep: security/CI implementation |
| [#5](https://github.com/Masterleeaus/Sorted/issues/5) | [Intake] Implement secure photo attachments for public service requests | 0/8 | Keep: distinct implementation |
| [#4](https://github.com/Masterleeaus/Sorted/issues/4) | [CI] Resolve the 754 Knip unused-file findings without hiding real dead code | 0/7 | Keep: security/CI implementation |

### Skilled

**Open:** 53; **task checkboxes:** 442; **checked:** 0; **missing checklist:** 0; **historically closed:** 71, including 61 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#320](https://github.com/Masterleeaus/Skilled/issues/320) | [Governance] Verify 61 legacy closed issues against task-completion policy | 0/74 | Keep: historic verification |
| [#314](https://github.com/Masterleeaus/Skilled/issues/314) | P1 FRONT DESK: scoped staff competency and permission UI contracts (one-plugin architecture) | 0/9 | Keep: one-plugin competency display |
| [#313](https://github.com/Masterleeaus/Skilled/issues/313) | P1 SKILLED: organisation onboarding, course mapping and training adoption reports for Front Desk customers | 0/8 | Keep: organization onboarding |
| [#312](https://github.com/Masterleeaus/Skilled/issues/312) | P1 SKILLED: service workflow microlearning and manager-approved coaching recommendations | 0/11 | Survivor of #308: approved microlearning |
| [#311](https://github.com/Masterleeaus/Skilled/issues/311) | P1 SKILLED: competency registry crosswalk for staff-role dispatch eligibility | 0/10 | Survivor of #307: competence status |
| [#310](https://github.com/Masterleeaus/Skilled/issues/310) | P0 SKILLED: Front Desk service-vertical knowledge API and published revision access | 0/11 | Survivor of #306: read-only published knowledge |
| [#304](https://github.com/Masterleeaus/Skilled/issues/304) | Front Desk service-vertical AI coaching and verified staff competency bridge | 0/8 | Keep: umbrella integration epic |
| [#303](https://github.com/Masterleeaus/Skilled/issues/303) | [Scan] Shared eslint config targets eslint 9 while the apps resolve eslint 10 | 0/10 | Keep: security/CI implementation |
| [#302](https://github.com/Masterleeaus/Skilled/issues/302) | [Scan] Three non-additive migrations ship without a rollback file | 0/10 | Keep: security/CI implementation |
| [#301](https://github.com/Masterleeaus/Skilled/issues/301) | [Scan] Unauthenticated live-class list exposes meeting links and recording URLs | 0/5 | Keep: security/CI implementation |
| [#300](https://github.com/Masterleeaus/Skilled/issues/300) | [Scan] Discussion routes return threads and replies without authentication or course-access checks | 0/5 | Keep: security/CI implementation |
| [#299](https://github.com/Masterleeaus/Skilled/issues/299) | [P0] Reconcile Skilled open curriculum and authentication PRs without regressing current main | 0/4 | Keep: security/CI implementation |
| [#298](https://github.com/Masterleeaus/Skilled/issues/298) | [P1] Complete learner, assessor, manager and payment journeys with verified CI | 0/6 | Keep: security/CI implementation |
| [#297](https://github.com/Masterleeaus/Skilled/issues/297) | [P0] Connect Skilled training, enrolment and verified competencies to Central and Sorted workforce | 0/6 | Keep: distinct implementation |
| [#210](https://github.com/Masterleeaus/Skilled/issues/210) | [P0] Verify Skilled/LMS shared PostgreSQL and Central integration end to end | 0/6 | Keep: distinct implementation |
| [#209](https://github.com/Masterleeaus/Skilled/issues/209) | Central integration: service calls with client credentials and LMS audience | 0/4 | Keep: distinct implementation |
| [#208](https://github.com/Masterleeaus/Skilled/issues/208) | Central integration: feature flags and signed outbox events | 0/3 | Keep: distinct implementation |
| [#207](https://github.com/Masterleeaus/Skilled/issues/207) | Central integration: tenant model, memberships and the company column | 0/3 | Keep: distinct implementation |
| [#206](https://github.com/Masterleeaus/Skilled/issues/206) | Central integration: service decision client with 5-minute expiry | 0/4 | Keep: distinct implementation |
| [#205](https://github.com/Masterleeaus/Skilled/issues/205) | Central integration: sign-in via Central OIDC (PKCE, per-app audience) | 0/3 | Keep: distinct implementation |
| [#204](https://github.com/Masterleeaus/Skilled/issues/204) | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) | 0/3 | Keep: distinct implementation |
| [#199](https://github.com/Masterleeaus/Skilled/issues/199) | New course: Short-stay host management | 0/12 | Keep: distinct implementation |
| [#198](https://github.com/Masterleeaus/Skilled/issues/198) | New course: Tutoring | 0/13 | Keep: distinct implementation |
| [#197](https://github.com/Masterleeaus/Skilled/issues/197) | New course: Nutrition, weight loss and dieting consultant | 0/13 | Keep: distinct implementation |
| [#196](https://github.com/Masterleeaus/Skilled/issues/196) | New course: Mobile nail technology | 0/9 | Keep: distinct implementation |
| [#195](https://github.com/Masterleeaus/Skilled/issues/195) | New course: Makeup artistry | 0/10 | Keep: distinct implementation |
| [#194](https://github.com/Masterleeaus/Skilled/issues/194) | New course: Dog training | 0/9 | Keep: distinct implementation |
| [#193](https://github.com/Masterleeaus/Skilled/issues/193) | Education and specialist courses (2) | 0/6 | Keep: distinct implementation |
| [#192](https://github.com/Masterleeaus/Skilled/issues/192) | Property and hospitality courses (2) | 0/6 | Keep: distinct implementation |
| [#191](https://github.com/Masterleeaus/Skilled/issues/191) | Health, fitness and wellbeing courses (3) | 0/3 | Keep: distinct implementation |
| [#190](https://github.com/Masterleeaus/Skilled/issues/190) | Personal services and beauty courses (5) | 0/5 | Keep: distinct implementation |
| [#189](https://github.com/Masterleeaus/Skilled/issues/189) | Pet services courses (4) | 0/4 | Keep: distinct implementation |
| [#188](https://github.com/Masterleeaus/Skilled/issues/188) | Outdoor and garden courses (7) | 0/7 | Keep: distinct implementation |
| [#187](https://github.com/Masterleeaus/Skilled/issues/187) | Trades and property maintenance courses (9) | 0/9 | Keep: distinct implementation |
| [#186](https://github.com/Masterleeaus/Skilled/issues/186) | Vehicles, appliances and furniture courses (3) | 0/3 | Keep: distinct implementation |
| [#185](https://github.com/Masterleeaus/Skilled/issues/185) | Cleaning services courses (15) | 0/15 | Keep: distinct implementation |
| [#175](https://github.com/Masterleeaus/Skilled/issues/175) | [Plan P1] Confirm the production PostgreSQL version on the host | 0/4 | Keep: distinct implementation |
| [#169](https://github.com/Masterleeaus/Skilled/issues/169) | [Plan P4] Compose: pin MinIO image and keep local-dev file off servers | 0/5 | Keep: distinct implementation |
| [#160](https://github.com/Masterleeaus/Skilled/issues/160) | [Plan P2] Wire the six new courses into every mapping file | 0/4 | Keep: distinct implementation |
| [#147](https://github.com/Masterleeaus/Skilled/issues/147) | [Plan] Owner decisions: hold list, draft-only verticals, regulated reviewers | 0/4 | Keep: distinct implementation |
| [#86](https://github.com/Masterleeaus/Skilled/issues/86) | [Brand] Remove legacy Titan Academy naming from learner-visible curriculum | 0/10 | Keep: distinct implementation |
| [#72](https://github.com/Masterleeaus/Skilled/issues/72) | [Brand and structure] Rebrand to SkilledAt.Work and consolidate the app source | 0/10 | Keep: distinct implementation |
| [#71](https://github.com/Masterleeaus/Skilled/issues/71) | [Central] Implement and verify Skilled's Central sign-in adapter | 0/10 | Keep: distinct implementation |
| [#68](https://github.com/Masterleeaus/Skilled/issues/68) | Move Skilled onto the shared company_id schema and Central migration chain | 0/10 | Keep: security/CI implementation |
| [#35](https://github.com/Masterleeaus/Skilled/issues/35) | [P1][ACA-022] Rehearse isolated deployment, secrets, backup and recovery runbooks | 0/7 | Keep: distinct implementation |
| [#34](https://github.com/Masterleeaus/Skilled/issues/34) | [P0][ACA-024] Obtain expert review for high-risk and regulated curriculum | 0/7 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Skilled/issues/26) | [P1][ACA-020] Run curriculum quality gates in GitHub CI | 0/6 | Keep: security/CI implementation |
| [#24](https://github.com/Masterleeaus/Skilled/issues/24) | [P1][ACA-011] Review all curriculum transfer and reuse classifications | 0/6 | Keep: distinct implementation |
| [#21](https://github.com/Masterleeaus/Skilled/issues/21) | [P1][ACA-010] Reconcile curriculum briefs with expanded lesson drafts | 0/6 | Keep: distinct implementation |
| [#20](https://github.com/Masterleeaus/Skilled/issues/20) | [P0][ACA-006] Map unmapped lesson drafts to approved courses | 0/6 | Keep: distinct implementation |
| [#19](https://github.com/Masterleeaus/Skilled/issues/19) | [P0][ACA-007] Review curriculum drafts without measurable learning outcomes | 0/6 | Keep: distinct implementation |
| [#17](https://github.com/Masterleeaus/Skilled/issues/17) | [P0][ACA-005] Reconcile curriculum drafts missing usable instructional sections | 0/6 | Keep: distinct implementation |
| [#9](https://github.com/Masterleeaus/Skilled/issues/9) | [P1] Verify current main end to end: API, browser, learner and assessor flows | 0/8 | Keep: distinct implementation |

### Supercharged

**Open:** 53; **task checkboxes:** 472; **checked:** 0; **missing checklist:** 0; **historically closed:** 87, including 82 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#344](https://github.com/Masterleeaus/Supercharged/issues/344) | [Governance] Verify 82 legacy closed issues against task-completion policy | 0/96 | Keep: historic verification |
| [#343](https://github.com/Masterleeaus/Supercharged/issues/343) | [P0 Security] Remove appointment webhook secrets from URL paths and verify signed delivery | 0/7 | Keep: security/CI implementation |
| [#338](https://github.com/Masterleeaus/Supercharged/issues/338) | P0 AGENT: deterministic provider sandbox and end-to-end voice-to-booking test suite | 0/9 | Keep: test matrix |
| [#337](https://github.com/Masterleeaus/Supercharged/issues/337) | P1 OPERATIONS: conversation dashboard, human inbox, summary and action approvals | 0/9 | Keep: distinct implementation |
| [#336](https://github.com/Masterleeaus/Supercharged/issues/336) | P1 AI SALES: outbound message policy, contact suppression and conversion attribution | 0/10 | Keep: consent / suppression |
| [#335](https://github.com/Masterleeaus/Supercharged/issues/335) | P1 AI: business-specific RAG onboarding, multilingual accuracy and response governance | 0/10 | Keep: published knowledge / RAG |
| [#334](https://github.com/Masterleeaus/Supercharged/issues/334) | P0 AGENT TEAM: signed booking tools with deterministic Scheduling & Enquiries Manager authority | 0/11 | Keep: deterministic booking tools |
| [#333](https://github.com/Masterleeaus/Supercharged/issues/333) | P0 AGENT TEAM: hosted voice calls, escalation and failover (single-plugin boundary) | 0/10 | Keep: voice session lifecycle |
| [#330](https://github.com/Masterleeaus/Supercharged/issues/330) | P1 AGENT TEAM: consent-safe missed-call recovery, quotes and follow-up | 0/8 | Keep: distinct implementation |
| [#329](https://github.com/Masterleeaus/Supercharged/issues/329) | P1 AI ASSISTANT: shared multilingual knowledge-grounded conversations (no duplicate chatbot) | 0/9 | Keep: conversational runtime |
| [#328](https://github.com/Masterleeaus/Supercharged/issues/328) | P0 AGENT TEAM: signed telephony events, consent and secure handoff for Scheduling & Enquiries Manager | 0/8 | Keep: provider event adapter |
| [#325](https://github.com/Masterleeaus/Supercharged/issues/325) | P0 AGENT TEAM: hosted voice receptionist, lead capture and missed-call recovery | 0/5 | Keep: parent Agent Team hosted voice |
| [#324](https://github.com/Masterleeaus/Supercharged/issues/324) | [Scan] Widget config skips domain allowlist when Origin and Referer are absent | 0/5 | Keep: security/CI implementation |
| [#323](https://github.com/Masterleeaus/Supercharged/issues/323) | [Scan] rag-knowledge.ts has 10 strict-mode errors on untyped catch variables | 0/7 | Keep: security/CI implementation |
| [#322](https://github.com/Masterleeaus/Supercharged/issues/322) | [Scan] searchKnowledge catch-block test pins old `catch (error: any)` text | 0/7 | Keep: security/CI implementation |
| [#321](https://github.com/Masterleeaus/Supercharged/issues/321) | [Scan] plugin-loader-policy tests pin a removed `as any` fragment (3 failures) | 0/9 | Keep: security/CI implementation |
| [#320](https://github.com/Masterleeaus/Supercharged/issues/320) | [Scan] route-auth coverage test fails: 139 routes missing from allowlist | 0/5 | Keep: security/CI implementation |
| [#319](https://github.com/Masterleeaus/Supercharged/issues/319) | [Scan] Plivo voice webhooks shadowed by /api/plivo/voice/:callId route | 0/5 | Source ordering fixed; runtime tests unchecked |
| [#318](https://github.com/Masterleeaus/Supercharged/issues/318) | [P1] Finish AI agent, inbox, chatbot, campaign and approval runtime before go-live | 0/6 | Keep: distinct implementation |
| [#317](https://github.com/Masterleeaus/Supercharged/issues/317) | [P0] Reconcile conflicting Supercharged PRs and finish required CI/typecheck gates | 0/5 | Keep: security/CI implementation |
| [#315](https://github.com/Masterleeaus/Supercharged/issues/315) | [P0] Deliver tenant-safe cross-app communications and AI actions for Scheduled and Sorted | 0/8 | Keep: distinct implementation |
| [#254](https://github.com/Masterleeaus/Supercharged/issues/254) | Two-company tenant-isolation and drift tests on disposable PostgreSQL (Part of #51) | 0/10 | Keep: distinct implementation |
| [#253](https://github.com/Masterleeaus/Supercharged/issues/253) | Move schema changes into Central migration chain and block app-local schema drift (Part of #51) | 0/10 | Keep: security/CI implementation |
| [#252](https://github.com/Masterleeaus/Supercharged/issues/252) | withTenant() as enforced DB boundary and company-scoped store/query code (Part of #51) | 0/10 | Keep: distinct implementation |
| [#251](https://github.com/Masterleeaus/Supercharged/issues/251) | Additive reversible migrations adding company_id, FKs, indexes and RLS (Part of #51) | 0/10 | Keep: security/CI implementation |
| [#250](https://github.com/Masterleeaus/Supercharged/issues/250) | company_id schema design and table registry (Part of #51) | 0/10 | Keep: distinct implementation |
| [#197](https://github.com/Masterleeaus/Supercharged/issues/197) | [P0] Verify AI Workforce shared PostgreSQL, tenant boundaries and Central integration | 0/6 | Keep: distinct implementation |
| [#196](https://github.com/Masterleeaus/Supercharged/issues/196) | Central integration: consume feature flags and signed outbox events | 0/3 | Keep: distinct implementation |
| [#195](https://github.com/Masterleeaus/Supercharged/issues/195) | Central integration: tenant model, memberships and the company column | 0/3 | Keep: distinct implementation |
| [#194](https://github.com/Masterleeaus/Supercharged/issues/194) | Central integration: service calls with client credentials and product audience | 0/4 | Keep: distinct implementation |
| [#192](https://github.com/Masterleeaus/Supercharged/issues/192) | Central integration: sign account-link assertions (EdDSA, titan-link+jwt) | 0/4 | Keep: distinct implementation |
| [#176](https://github.com/Masterleeaus/Supercharged/issues/176) | [Vertical 40/50] Mobile beauty | 0/6 | Keep: distinct implementation |
| [#175](https://github.com/Masterleeaus/Supercharged/issues/175) | [Vertical 39/50] Mobile hairdressing and barbering | 0/6 | Keep: distinct implementation |
| [#173](https://github.com/Masterleeaus/Supercharged/issues/173) | [Vertical 37/50] Pet grooming | 0/6 | Keep: distinct implementation |
| [#172](https://github.com/Masterleeaus/Supercharged/issues/172) | [Vertical 36/50] Pet and house sitting | 0/6 | Keep: distinct implementation |
| [#171](https://github.com/Masterleeaus/Supercharged/issues/171) | [Vertical 35/50] Dog walking | 0/6 | Keep: distinct implementation |
| [#170](https://github.com/Masterleeaus/Supercharged/issues/170) | [Vertical 34/50] Aquarium maintenance | 0/6 | Keep: distinct implementation |
| [#168](https://github.com/Masterleeaus/Supercharged/issues/168) | [Vertical 32/50] Pond and water-feature maintenance | 0/6 | Keep: distinct implementation |
| [#133](https://github.com/Masterleeaus/Supercharged/issues/133) | Remove committed archives and logs; add ignore rules; check for secrets first | 0/10 | Keep: distinct implementation |
| [#129](https://github.com/Masterleeaus/Supercharged/issues/129) | [Client] Break up the largest pages and admin panels | 0/4 | Keep: distinct implementation |
| [#127](https://github.com/Masterleeaus/Supercharged/issues/127) | [Tenancy] Extend tenant-isolation checks to every module | 0/4 | Keep: distinct implementation |
| [#122](https://github.com/Masterleeaus/Supercharged/issues/122) | [CI] Make the Typecheck a required check, area by area | 0/4 | Keep: security/CI implementation |
| [#54](https://github.com/Masterleeaus/Supercharged/issues/54) | [Brand] Rebrand Supercharged surfaces and consolidate the app source into a cohesive base | 0/10 | Keep: distinct implementation |
| [#53](https://github.com/Masterleeaus/Supercharged/issues/53) | [Central] Implement and verify Supercharged's Central sign-in adapter | 0/13 | Keep: distinct implementation |
| [#51](https://github.com/Masterleeaus/Supercharged/issues/51) | Move Supercharged onto the shared company_id schema and Central migration chain | 0/10 | Keep: security/CI implementation |
| [#48](https://github.com/Masterleeaus/Supercharged/issues/48) | [Synced] Make the customer chatbot builder a first-class Synced mode | 0/10 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Supercharged/issues/26) | [Chatbot] Owner open items and unverified checks | 0/10 | Keep: distinct implementation |
| [#24](https://github.com/Masterleeaus/Supercharged/issues/24) | [Chatbot] Background workers and voice call service are not constructed in server/ | 0/10 | Keep: distinct implementation |
| [#22](https://github.com/Masterleeaus/Supercharged/issues/22) | [Chatbot] Channel and widget reply runtime and receipt store are stubs | 0/5 | Keep: distinct implementation |
| [#19](https://github.com/Masterleeaus/Supercharged/issues/19) | [Feature] appointment.reminder_sent webhook trigger is not implemented | 0/4 | Keep: distinct implementation |
| [#17](https://github.com/Masterleeaus/Supercharged/issues/17) | [Upgrade] Split server/routes.ts and flow-automation-routes.ts into smaller modules | 0/7 | Keep: distinct implementation |
| [#15](https://github.com/Masterleeaus/Supercharged/issues/15) | [Upgrade] About 2,900 uses of `any` in server, shared, and client | 0/5 | Keep: distinct implementation |
| [#2](https://github.com/Masterleeaus/Supercharged/issues/2) | [Security] Webhook secret files are committed to git | 0/5 | Keep: security/CI implementation |

### Central

**Open:** 55; **task checkboxes:** 482; **checked:** 6; **missing checklist:** 0; **historically closed:** 29, including 27 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#168](https://github.com/Masterleeaus/Central/issues/168) | P1 GOVERNANCE: retrospectively verify closed issues missing task checklists across Titan Zero | 1/11 | Keep: seven-core legacy closures evidence audit |
| [#167](https://github.com/Masterleeaus/Central/issues/167) | [Governance] Verify 27 legacy closed issues against task-completion policy | 0/37 | Keep: historic verification |
| [#160](https://github.com/Masterleeaus/Central/issues/160) | P0 RELEASE: cross-product integration staging suite and production go/no-go checklist | 0/8 | Keep: release gate |
| [#159](https://github.com/Masterleeaus/Central/issues/159) | P1 WORKFORCE: shared smart task orchestration, pause/approve/retry policies and outcomes | 0/9 | Keep: distinct implementation |
| [#158](https://github.com/Masterleeaus/Central/issues/158) | P1 CROSS-APP: privacy policy, tenant audit, consent ledger and data deletion orchestration | 0/9 | Keep: distinct implementation |
| [#157](https://github.com/Masterleeaus/Central/issues/157) | P1 COMMERCE: Scheduling & Enquiries Manager in-plugin hosted AI upgrades | 0/12 | Keep: distinct implementation |
| [#156](https://github.com/Masterleeaus/Central/issues/156) | P0 CATALOG: Scheduling & Enquiries Manager — Free / Assistant / Agent Team entitlements | 0/7 | Keep: distinct implementation |
| [#154](https://github.com/Masterleeaus/Central/issues/154) | P1 Front Desk hosted AI execution receipts, cost observability and abuse controls | 0/9 | Keep: distinct implementation |
| [#153](https://github.com/Masterleeaus/Central/issues/153) | P0: Scheduling & Enquiries Manager — Assistant and Agent Team subscription billing | 0/10 | Keep: distinct implementation |
| [#152](https://github.com/Masterleeaus/Central/issues/152) | P0 Front Desk WordPress site and company pairing: secure delegated permissions | 0/11 | Keep: security/CI implementation |
| [#151](https://github.com/Masterleeaus/Central/issues/151) | CI workflow hard-codes the database password in 35 places | 0/4 | Keep: security/CI implementation |
| [#149](https://github.com/Masterleeaus/Central/issues/149) | EPIC Front Desk one-plugin hosted AI: identity, Assistant/Agent Team entitlements and receipts | 0/9 | Keep: parent/epic |
| [#147](https://github.com/Masterleeaus/Central/issues/147) | [Scan] Stale expected-fail markers hide passing Scheduled conformance checks | 0/5 | Keep: security/CI implementation |
| [#146](https://github.com/Masterleeaus/Central/issues/146) | [Scan] Central accepts stale and future-dated Scheduled envelopes | 0/6 | Keep: security/CI implementation |
| [#145](https://github.com/Masterleeaus/Central/issues/145) | [Scan] Nine PostgreSQL feature-flag tests skip in every CI run | 0/5 | Keep: security/CI implementation |
| [#144](https://github.com/Masterleeaus/Central/issues/144) | [Scan] CI never runs the Scheduled conformance suite that root npm test includes | 0/7 | Keep: security/CI implementation |
| [#142](https://github.com/Masterleeaus/Central/issues/142) | [P1] Production operations and release readiness matrix for the five-app integrated platform | 0/6 | Keep: distinct implementation |
| [#141](https://github.com/Masterleeaus/Central/issues/141) | [P0] Prove Central login is the only unified-mode login across all five products | 0/6 | Keep: distinct implementation |
| [#140](https://github.com/Masterleeaus/Central/issues/140) | [P0][Five-app] Enforce one physical PostgreSQL database with per-product schemas and one migration ledger | 0/7 | Keep: physical database migration |
| [#107](https://github.com/Masterleeaus/Central/issues/107) | Finish and merge feat/decision-expiry-5min so service decisions carry expiresAt | 0/4 | Keep: distinct implementation |
| [#106](https://github.com/Masterleeaus/Central/issues/106) | Set hostnames, DNS and TLS for each product | 0/5 | Keep: distinct implementation |
| [#105](https://github.com/Masterleeaus/Central/issues/105) | Publish versioned Central contract test vectors for product CI | 0/4 | Keep: security/CI implementation |
| [#104](https://github.com/Masterleeaus/Central/issues/104) | Map per-product entitlement keys to Central subscription entitlements | 0/5 | Keep: distinct implementation |
| [#103](https://github.com/Masterleeaus/Central/issues/103) | Define cross-product data contracts for shared customers, jobs, bookings and learner records | 0/5 | Keep: distinct implementation |
| [#102](https://github.com/Masterleeaus/Central/issues/102) | Propagate session revocation and global logout to every product | 0/4 | Keep: distinct implementation |
| [#101](https://github.com/Masterleeaus/Central/issues/101) | Define onboarding and rotation of product link-assertion public keys | 0/5 | Keep: distinct implementation |
| [#100](https://github.com/Masterleeaus/Central/issues/100) | Add Scheduled to the Central product registry, audience and operator config | 2/5 | Keep: distinct implementation |
| [#99](https://github.com/Masterleeaus/Central/issues/99) | Provision Logto machine-to-machine clients for each product service token | 0/4 | Keep: distinct implementation |
| [#98](https://github.com/Masterleeaus/Central/issues/98) | Provision Logto OIDC applications for Sorted, Supercharged, LMS and Scheduled | 0/5 | Keep: distinct implementation |
| [#95](https://github.com/Masterleeaus/Central/issues/95) | Upgrade plan: Central | 0/33 | Keep: parent/epic |
| [#83](https://github.com/Masterleeaus/Central/issues/83) | [P0] Define and verify unified + standalone deployment contracts for all five Titan products | 3/31 | Keep: unified/standalone deployment contract |
| [#82](https://github.com/Masterleeaus/Central/issues/82) | [P0] Cross-repository shared PostgreSQL integration acceptance gate | 0/6 | Keep: distinct implementation |
| [#74](https://github.com/Masterleeaus/Central/issues/74) | Deployment checks for the public proxy: block /metrics, /internal/ and /v1/admin | 0/5 | Keep: distinct implementation |
| [#72](https://github.com/Masterleeaus/Central/issues/72) | Register the launcher OIDC application so sign-in can start | 0/10 | Keep: distinct implementation |
| [#71](https://github.com/Masterleeaus/Central/issues/71) | Align Skilled link-assertion fixtures with the Central link contract | 0/8 | Keep: distinct implementation |
| [#70](https://github.com/Masterleeaus/Central/issues/70) | Align the Skilled service-decision endpoint (#68) with Skilled's client | 0/9 | Keep: distinct implementation |
| [#44](https://github.com/Masterleeaus/Central/issues/44) | [Product UI] Build the Titan Central sign-in and product launcher | 0/10 | Keep: distinct implementation |
| [#43](https://github.com/Masterleeaus/Central/issues/43) | Define the single Titan database, canonical company boundary, and migration registry | 0/13 | Keep: security/CI implementation |
| [#41](https://github.com/Masterleeaus/Central/issues/41) | [High] Create a guided customer onboarding and product provisioning workflow | 0/8 | Keep: distinct implementation |
| [#40](https://github.com/Masterleeaus/Central/issues/40) | [High] Add a durable event and workflow mechanism for cross-product handoffs | 0/8 | Keep: distinct implementation |
| [#39](https://github.com/Masterleeaus/Central/issues/39) | [Medium] Build a role-scoped support and operations console | 0/8 | Keep: distinct implementation |
| [#38](https://github.com/Masterleeaus/Central/issues/38) | [Medium] Add centrally governed configuration and gradual feature rollouts | 0/8 | Keep: distinct implementation |
| [#37](https://github.com/Masterleeaus/Central/issues/37) | [High] Build a verified account-linking workflow for connected products | 0/7 | Keep: distinct implementation |
| [#36](https://github.com/Masterleeaus/Central/issues/36) | [Medium] Provide a unified, privacy-conscious activity and audit history | 0/8 | Keep: distinct implementation |
| [#35](https://github.com/Masterleeaus/Central/issues/35) | [High] Connect subscription lifecycle to product entitlements | 0/7 | Keep: distinct implementation |
| [#34](https://github.com/Masterleeaus/Central/issues/34) | [High] Add central organisation and user administration across connected products | 0/8 | Keep: distinct implementation |
| [#32](https://github.com/Masterleeaus/Central/issues/32) | [Medium] Add a safe organisation-selection flow for multi-organisation users | 0/4 | Keep: distinct implementation |
| [#29](https://github.com/Masterleeaus/Central/issues/29) | [High] Add Central integration contracts for Sorted, Supercharged and LMS repositories | 0/8 | Keep: distinct implementation |
| [#28](https://github.com/Masterleeaus/Central/issues/28) | Epic: Titan Central as the main entry and auth for Sorted, Supercharged and LMS | 0/28 | Keep: foundational auth security checklist |
| [#27](https://github.com/Masterleeaus/Central/issues/27) | [Medium] LMS app, domain and adapter are not implemented | 0/4 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Central/issues/26) | [High] Sorted session adapter and account mapping are not implemented | 0/4 | Keep: distinct implementation |
| [#25](https://github.com/Masterleeaus/Central/issues/25) | [High] Supercharged session adapter and account mapping are not implemented | 0/4 | Keep: distinct implementation |
| [#24](https://github.com/Masterleeaus/Central/issues/24) | [High] Upstream Logto is not vendored, pinned or verified here | 0/6 | Keep: distinct implementation |
| [#16](https://github.com/Masterleeaus/Central/issues/16) | [Medium] No audit trail for access decisions and thin observability | 0/7 | Keep: distinct implementation |
| [#6](https://github.com/Masterleeaus/Central/issues/6) | [High] Global logout is not implemented | 0/6 | Keep: distinct implementation |

### Titan-Zero-Trades-Front-Desk

**Open:** 44; **task checkboxes:** 556; **checked:** 2; **missing checklist:** 0; **historically closed:** 6, including 0 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#49](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/49) | P0: Scheduling & Enquiries Manager — migrate former Pro features into one plugin | 2/104 | Keep: former-Pro functionality migration |
| [#48](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/48) | P0: Scheduling & Enquiries Manager — specialist AI Agent Team | 0/16 | Keep: Agent Team |
| [#47](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/47) | P0: Scheduling & Enquiries Manager — full hosted AI Assistant | 0/17 | Keep: hosted Assistant |
| [#46](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/46) | P0: Scheduling & Enquiries Manager — in-dashboard AI services upgrade, billing and downgrade | 0/23 | Keep: upgrades/entitlements |
| [#45](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/45) | EPIC P0: Scheduling & Enquiries Manager — one WordPress plugin, Free → AI Assistant → AI Agent Team | 0/17 | Canonical product epic |
| [#44](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/44) | P0 FREE AI RELEASE: security, WordPress.org serviceware compliance and pilot cost verification | 0/19 | Keep: security/CI implementation |
| [#43](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/43) | P0 FREE AI FOUNDATION: optional proxy connection, consent, budgets, embeddings and inference observability | 0/6 | Keep: distinct implementation |
| [#42](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/42) | P0 FREE AI FOUNDATION: deterministic intent engine, tenant FAQ store, exact/semantic cache and invalidation | 0/15 | Keep: distinct implementation |
| [#41](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/41) | P1 FREE AI 22: Monthly AI Insights Summary | 0/10 | Keep: distinct implementation |
| [#40](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/40) | P1 FREE AI 21: AI-Guided Plugin Setup | 0/11 | Keep: distinct implementation |
| [#39](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/39) | P0 FREE AI 20: AI Knowledge Builder & Editor | 0/10 | Keep: distinct implementation |
| [#38](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/38) | P1 FREE AI 19: Customer Conversation Summaries | 0/10 | Keep: distinct implementation |
| [#37](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/37) | P1 FREE AI 18: Smart Reply Drafts | 0/10 | Keep: distinct implementation |
| [#36](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/36) | P0 FREE AI 17: FAQ Knowledge Gap Detection | 0/10 | Keep: distinct implementation |
| [#35](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/35) | P0 FREE AI 16: Weekly AI FAQ Suggestions | 0/9 | Keep: distinct implementation |
| [#34](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/34) | P0 FREE AI 15: Spam & Duplicate Enquiry Detection | 0/11 | Keep: distinct implementation |
| [#33](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/33) | P1 FREE AI 14: Follow-Up Suggestions | 0/10 | Keep: distinct implementation |
| [#32](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/32) | P0 FREE AI 13: Quote Request Classification | 0/9 | Keep: distinct implementation |
| [#31](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/31) | P1 FREE AI 12: Missed-Call Reply Intelligence | 0/14 | Keep: distinct implementation |
| [#30](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/30) | P0 FREE AI 11: Missed-Call Recognition & Callback Tasks | 0/10 | Keep: distinct implementation |
| [#29](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/29) | P0 FREE AI 10: Lead Urgency Detection | 0/10 | Keep: distinct implementation |
| [#28](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/28) | P0 FREE AI 09: Deterministic Enquiry Triage | 0/7 | Keep: distinct implementation |
| [#27](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/27) | P0 FREE AI 08: Human Handoff & Escalation | 0/7 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/26) | P1 FREE AI 07: Basic Multilingual Assistance | 0/8 | Keep: distinct implementation |
| [#25](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/25) | P0 FREE AI 06: Cancellation & Rescheduling Assistant | 0/7 | Keep: distinct implementation |
| [#24](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/24) | P0 FREE AI 05: Guided Booking Assistant | 0/7 | Keep: distinct implementation |
| [#23](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/23) | P0 FREE AI 04: Smart Service Finder | 0/7 | Keep: distinct implementation |
| [#22](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/22) | P0 FREE AI 03: Business Knowledge Assistant | 0/8 | Keep: distinct implementation |
| [#21](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/21) | P0 FREE AI 02: Semantic FAQ Search | 0/14 | Keep: distinct implementation |
| [#20](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/20) | P0 FREE AI 01: AI Answer Box | 0/15 | Keep: distinct implementation |
| [#19](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/19) | EPIC P0: Make Front Desk Free genuinely AI-powered — 22 features, optional proxy, limits, safe fallback | 0/25 | Keep: 22-feature Free AI sub-epic |
| [#17](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/17) | P0 FREE: consent-driven legacy AI data/config migration and rollback UI | 0/10 | Keep: security/CI implementation |
| [#16](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/16) | P0: versioned one-plugin local-to-hosted service contracts and tool permissions | 0/8 | Keep: security/CI implementation |
| [#15](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/15) | P2 PLUGIN: onboarding, admin setup and contextual upgrade conversion without dark patterns | 0/11 | Keep: distinct implementation |
| [#14](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/14) | P1 AGENT: front-desk delegated tool permissions and action receipt viewer | 0/5 | Keep: security/CI implementation |
| [#12](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/12) | P1 LOCAL: advanced reports, exports and customer segmentation in one plugin | 0/5 | Keep: distinct implementation |
| [#11](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/11) | P1 LOCAL: multi-location, staff and advanced service policy workflows in one plugin | 0/5 | Keep: distinct implementation |
| [#9](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/9) | P0 PLUGIN: final free plugin packaging, accessibility, i18n, updates and WordPress.org readme | 0/5 | Keep: distinct implementation |
| [#8](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/8) | P0 PLUGIN: harden booking security, REST/AJAX authorization and privacy consent | 0/8 | Keep: security/CI implementation |
| [#7](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/7) | P0 PLUGIN: end-to-end booking runtime tests, activation, upgrade and rollback | 0/10 | Keep: distinct implementation |
| [#6](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/6) | P0 PLUGIN: reproduce current source, compare cumulative Pass 03 and prevent lost upgrades | 0/10 | Keep: distinct implementation |
| [#4](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/4) | P1: one Free plugin signed AI service connector for Free / Assistant / Agent Team | 0/5 | Keep: distinct implementation |
| [#3](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/3) | P0 Front Desk WordPress.org submission gate: licensing, security, compatibility and reproducible package | 0/8 | Keep: security/CI implementation |
| [#2](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/2) | P0 Front Desk free edition: eliminate AI execution paths without breaking bookings | 0/10 | Keep: distinct implementation |

### Titan-zero-website

**Open:** 44; **task checkboxes:** 371; **checked:** 4; **missing checklist:** 0; **historically closed:** 5, including 0 with no checklist and 0 with unchecked tasks.

| Issue | Title | Checked / total | Issue disposition |
|---|---|---:|---|
| [#52](https://github.com/Masterleeaus/Titan-zero-website/issues/52) | [Governance] Verify 1 legacy closed issues against task-completion policy | 1/9 | Keep: historic verification |
| [#46](https://github.com/Masterleeaus/Titan-zero-website/issues/46) | P0 TOOLS RELEASE: source/published parity, accessibility, formula tests and publishing CI | 0/8 | Keep: security/CI implementation |
| [#45](https://github.com/Masterleeaus/Titan-zero-website/issues/45) | P1 TOOLS SITE: redesign 19-tool directory with categories, search and contextual product journeys | 0/8 | Keep: distinct implementation |
| [#44](https://github.com/Masterleeaus/Titan-zero-website/issues/44) | P1 TOOLS PLATFORM: connect calculator results, scenarios and local profiles safely | 0/7 | Keep: distinct implementation |
| [#43](https://github.com/Masterleeaus/Titan-zero-website/issues/43) | P0 TOOLS PLATFORM: protect private calculation data in sharing, storage and handoffs | 0/9 | Keep: distinct implementation |
| [#42](https://github.com/Masterleeaus/Titan-zero-website/issues/42) | P0 TOOLS PLATFORM: testable shared calculation engine, input validation and currency precision | 0/9 | Keep: distinct implementation |
| [#41](https://github.com/Masterleeaus/Titan-zero-website/issues/41) | P1 TOOLS NEW: six-optional-upgrade cost and scenario configurator | 0/9 | Keep: distinct implementation |
| [#40](https://github.com/Masterleeaus/Titan-zero-website/issues/40) | P1 TOOLS NEW: customer response and follow-up planner | 0/8 | Keep: distinct implementation |
| [#39](https://github.com/Masterleeaus/Titan-zero-website/issues/39) | P1 TOOLS NEW: staff utilisation and training planner | 0/7 | Keep: distinct implementation |
| [#38](https://github.com/Masterleeaus/Titan-zero-website/issues/38) | P1 TOOLS NEW: thirteen-week business cash-flow forecast | 0/8 | Keep: distinct implementation |
| [#37](https://github.com/Masterleeaus/Titan-zero-website/issues/37) | P1 TOOLS NEW: recurring service revenue and retention calculator | 0/8 | Keep: distinct implementation |
| [#36](https://github.com/Masterleeaus/Titan-zero-website/issues/36) | P1 TOOLS NEW: travel and route cost calculator | 0/7 | Keep: distinct implementation |
| [#35](https://github.com/Masterleeaus/Titan-zero-website/issues/35) | P0 TOOLS NEW: booking revenue, cancellation and no-show planner | 0/7 | Keep: distinct implementation |
| [#34](https://github.com/Masterleeaus/Titan-zero-website/issues/34) | P0 TOOLS NEW: service pricing and minimum viable quote calculator | 0/8 | Keep: distinct implementation |
| [#33](https://github.com/Masterleeaus/Titan-zero-website/issues/33) | P0 TOOLS: checklist generator — preserve completion state and reusable templates | 0/7 | Keep: distinct implementation |
| [#32](https://github.com/Masterleeaus/Titan-zero-website/issues/32) | P1 TOOLS: job-cost sheet — detailed cost categories and traceable estimates | 0/7 | Keep: distinct implementation |
| [#31](https://github.com/Masterleeaus/Titan-zero-website/issues/31) | P0 TOOLS: quote builder — persistence, professional documents and tax correctness | 0/8 | Keep: distinct implementation |
| [#30](https://github.com/Masterleeaus/Titan-zero-website/issues/30) | P1 TOOLS: invoice collection — receivables ageing and 13-week cash timing | 0/6 | Keep: distinct implementation |
| [#29](https://github.com/Masterleeaus/Titan-zero-website/issues/29) | P1 TOOLS: lead-conversion calculator — stage funnel and contribution change | 0/6 | Keep: distinct implementation |
| [#28](https://github.com/Masterleeaus/Titan-zero-website/issues/28) | P1 TOOLS: missed-enquiry calculator — realistic recovery and contribution scenarios | 0/7 | Keep: distinct implementation |
| [#27](https://github.com/Masterleeaus/Titan-zero-website/issues/27) | P1 TOOLS: capacity planner — travel, leave, durations and service constraints | 0/10 | Keep: distinct implementation |
| [#26](https://github.com/Masterleeaus/Titan-zero-website/issues/26) | P1 TOOLS: job-profitability calculator — contribution, net profit and margin/markup clarity | 0/10 | Keep: distinct implementation |
| [#25](https://github.com/Masterleeaus/Titan-zero-website/issues/25) | P1 TOOLS: hiring-cost calculator — roster, on-cost and contractor scenarios | 0/9 | Keep: distinct implementation |
| [#24](https://github.com/Masterleeaus/Titan-zero-website/issues/24) | P1 TOOLS: admin-cost calculator — recoverable time versus actual savings | 0/9 | Keep: distinct implementation |
| [#23](https://github.com/Masterleeaus/Titan-zero-website/issues/23) | P0 TOOLS: correct break-even no-contribution result and invalid financial states | 3/7 | Keep: distinct implementation |
| [#22](https://github.com/Masterleeaus/Titan-zero-website/issues/22) | EPIC: upgrade 11 existing tools and deliver a connected 19-tool Titan Zero business suite | 0/10 | Keep: 19-tool program |
| [#21](https://github.com/Masterleeaus/Titan-zero-website/issues/21) | P0 WEBSITE: static generation source-of-truth and CI drift/link/accessibility gate | 0/10 | Keep: security/CI implementation |
| [#20](https://github.com/Masterleeaus/Titan-zero-website/issues/20) | P1 WEBSITE: reconcile Free plugin acquisition vs Titan BOS free core in all copy and metadata | 0/10 | Keep: distinct implementation |
| [#19](https://github.com/Masterleeaus/Titan-zero-website/issues/19) | P0 WEBSITE: correct Front Desk SEO hierarchy, breadcrumb parent and global navigation across published pages | 0/13 | Keep: SEO, breadcrumbs |
| [#18](https://github.com/Masterleeaus/Titan-zero-website/issues/18) | P1 WEBSITE: reciprocal Front Desk integration sections on four At.Work application pages | 0/9 | Keep: distinct implementation |
| [#17](https://github.com/Masterleeaus/Titan-zero-website/issues/17) | P0 WEBSITE: Scheduling & Enquiries Manager in-plugin AI service upgrade selector | 0/10 | Keep: distinct implementation |
| [#16](https://github.com/Masterleeaus/Titan-zero-website/issues/16) | P0 WEBSITE: connected apps & six upgrades without Pro plugin | 0/10 | Keep: upgrade presentation |
| [#15](https://github.com/Masterleeaus/Titan-zero-website/issues/15) | P0 WEBSITE: Scheduling & Enquiries Manager six-upgrade catalogue | 0/10 | Keep: product catalogue |
| [#14](https://github.com/Masterleeaus/Titan-zero-website/issues/14) | P1 WEBSITE: Front Desk integration documentation, product support and service status pages | 0/8 | Keep: distinct implementation |
| [#11](https://github.com/Masterleeaus/Titan-zero-website/issues/11) | P0 WEBSITE: Scheduling & Enquiries Manager product hub and hosted AI upgrades | 0/10 | Keep: product hub |
| [#9](https://github.com/Masterleeaus/Titan-zero-website/issues/9) | EPIC WEBSITE: Scheduling & Enquiries Manager — Free, AI Assistant and AI Agent Team | 0/8 | Keep: website parent epic |
| [#8](https://github.com/Masterleeaus/Titan-zero-website/issues/8) | P1 WEBSITE: front desk industry-specific conversion sections and FAQs | 0/6 | Keep: distinct implementation |
| [#7](https://github.com/Masterleeaus/Titan-zero-website/issues/7) | P1 WEBSITE: conversion tracking, SEO, legal and static site release verification | 0/8 | Keep: distinct implementation |
| [#6](https://github.com/Masterleeaus/Titan-zero-website/issues/6) | P1 WEBSITE: Front Desk product screenshots, illustration assets and design QA | 0/8 | Keep: distinct implementation |
| [#5](https://github.com/Masterleeaus/Titan-zero-website/issues/5) | P1 WEBSITE: Scheduling & Enquiries Manager — Free / Assistant / Agent Team pricing | 0/6 | Keep: distinct implementation |
| [#4](https://github.com/Masterleeaus/Titan-zero-website/issues/4) | P0 WEBSITE: Free + Assistant + Agent Team navigation, footer and sitemap | 0/11 | Keep: navigation and sitemap |
| [#3](https://github.com/Masterleeaus/Titan-zero-website/issues/3) | P0 WEBSITE: AI Agent Team for autonomous enquiries and bookings — no extra WP plugin | 0/8 | Keep: distinct implementation |
| [#2](https://github.com/Masterleeaus/Titan-zero-website/issues/2) | P0 WEBSITE: full hosted AI Assistant page (upgrade inside Free WordPress plugin) | 0/8 | Keep: distinct implementation |
| [#1](https://github.com/Masterleeaus/Titan-zero-website/issues/1) | P0 WEBSITE: retire Pro offer and preserve /frontdeskpro/ SEO route | 0/10 | Keep: distinct implementation |

## Verification totals and closure policy

- **320 open issues** across the seven repositories, **2885 task checkboxes**, **25 checked**, **0 without checklists** (snapshot; concurrent edits may change counts).
- **221 closed issues** returned; 189 historic closed issues still lack task checklists and 0 contain active unchecked boxes. Their content must be individually verified before claiming implementation completeness.
- Do not replace an unimplemented feature task with an “administrative duplicate” checkbox in the survivor. Keep active implementation/verification tasks unchecked. It is acceptable to retire a duplicate **tracker** with fully evidenced administrative consolidation, while preserving all uncompleted work in a canonical issue.
- A checked implementation task requires a concrete source commit/PR, repeatable tests (including negative/tenant/timezone/permission cases where applicable), CI verification and relevant deployment evidence. No production/cutover claim from README or issue prose alone.
- The seven repositories have issue intake/closure workflows. The closure gate attempts to reopen a prematurely closed issue and depends on GitHub Actions being enabled and permitted to write issues. It is not a native prevention of the initial Close click.

**Source:** linked GitHub issue bodies and the current canonical Central ADR-009 and Front Desk `docs/SINGLE-PLUGIN-AI-SERVICES-ARCHITECTURE.md`; inspect current code and PR statuses before executing any remaining implementation or closure.

## Post-audit closure consistency reconciliation — 2026-11-15

- Scheduled #11 was reopened because the ADR-009 booking/calendar ownership decision did **not** finish reminder/registry/integration acceptance work.
- Historic original issue bodies in 13 administratively closed duplicates were changed from active `- [ ]` task checkboxes into explicit non-checklist historical text, **without** checking them off or claiming implementation. Their live successor implementation issues remain open with unchecked tasks.
- Closed records with no checklists still require source/test/PR verification through the current legacy audits; they have **not** been certified.
- Outdated action-checkbox references to the superseded Front Desk epic #1 have been updated across Scheduled #62–#65, Sorted #106/#107/#109 and Supercharged #333–#337 to the canonical single-plugin epic #45.
