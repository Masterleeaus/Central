# Titan Zero seven-repository GitHub deep scan and issue-completion audit

**Audit date:** 2026-11-15 (Australia/Melbourne)  
**Scope:** GitHub default branches, repository roots and selected source files, issue bodies, open PRs, workflow policies and recent Actions. This is a **source-backed triage**, **not** a full clone/build/production penetration test. GitHub is being edited concurrently; counts are point-in-time.

## Authoritative repository scope

| Role | Repository | Open issues at final snapshot | Checkbox tasks | Checked |
| --- | --- | ---: | ---: | ---: |
| Public website, business tools | [Titan-zero-website](https://github.com/Masterleeaus/Titan-zero-website) | 46 | 374 | 0 |
| **One** installed WordPress Front Desk plugin | [Titan-Zero-Trades-Front-Desk](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk) | 48 | 472 | 0 |
| PlusAgency + Cleanto Scheduled Laravel app | [Scheduled](https://github.com/Masterleeaus/Scheduled) | 30 | 184 | 4 |
| Training, assessment and verifiable competencies | [Skilled](https://github.com/Masterleeaus/Skilled) | 63 | 474 | 0 |
| Identity, app links, entitlements, shared service control | [Central](https://github.com/Masterleeaus/Central) | 57 | 476 | 3 |
| Operations, field PWA, jobs/quotes/invoices | [Sorted](https://github.com/Masterleeaus/Sorted) | 45 | 361 | 0 |
| Communications, AI orchestration and voice | [Supercharged](https://github.com/Masterleeaus/Supercharged) | 58 | 477 | 0 |
| **Total active scope** | | **347** | **2,818** | **7** |

**All 347 open issues have at least one Markdown task checklist at the snapshot.** Zero issues with missing checklists. A checkbox means an individually trackable task; it does **not** prove that a feature is implemented. An unchecked checkbox may be waiting for evidence even when some source already exists. The 40 open issues in the [old Front Desk Pro specification repository](https://github.com/Masterleeaus/Titan-zero-front-desk-pro) also have checklists (271 tasks, 0 checked) but are historical migration inputs, not authorization to build another installer.

## Mandatory issue completion policy

- Every actionable issue needs a meaningful breakdown using Markdown `- [ ]` tasks, including implementation, unit/integration testing, security/tenancy/permission checks as relevant, and linked evidence.
- Change a task to `- [x]` **only after** the corresponding work was implemented and independently verified. A written plan, commit without passing checks, or documentation alone is not enough for a runtime acceptance task.
- Do not close while **any** required task remains unchecked. Issue-closure GitHub Actions automatically **reopen** attempts with absent/incomplete task lists; GitHub Actions are after-the-fact guards, not an immutable pre-click lock.
- A test of the active Front Desk closure guard is [issue #50](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/50): closing with 3 unfinished tasks triggered [automatic reopen comment](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/50#issuecomment-6893487452) and [expected failure run](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/actions/runs/43707982481). Then 3 verification tasks were checked with evidence and issue #50 successfully stayed closed, with [a passing workflow run](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/actions/runs/43708152907).
- Backfill/intake and closure workflows were reviewed in all active repositories. **The full reopen/pass exercise was performed in Front Desk only**; other repositories require independent closure simulations.
- Historical closed issues that pre-date the checklist policy are **not retroactively certified**. Do not blindly reopen or re-close them; compare claims to code, tests and historical PR evidence. Retrospective audits: [Website #52](https://github.com/Masterleeaus/Titan-zero-website/issues/52), [Skilled #320](https://github.com/Masterleeaus/Skilled/issues/320), [Central #167](https://github.com/Masterleeaus/Central/issues/167), [Sorted #115](https://github.com/Masterleeaus/Sorted/issues/115), [Supercharged #344](https://github.com/Masterleeaus/Supercharged/issues/344).

## Architecture and product authority

1. **One Front Desk plugin**: the active source is [Titan-Zero-Trades-Front-Desk](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk), plugin version `3.0.128` in `titan-zero-trades-front-desk/titan-zero-front-desk.php`. It retains free local WordPress booking/rules/data capabilities. Hosted **AI Assistant** and **AI Agent Team** are service upgrades inside the **same installation**, not separate Pro/AI-agent PHP plugins. Authoritative [Front Desk #45](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/45), #46–#49; related [Central #156](https://github.com/Masterleeaus/Central/issues/156). The old Pro repository README itself says it is superseded. Review obsolete Pro references in dependent issues before coding, but preserve necessary feature acceptance criteria.
2. **Scheduled** README says one combined Laravel application retains imported Cleanto booking source and PlusAgency publishing. Source import is not a completed end-to-end test. Current `core/config/database.php` defaults to MySQL; shared PostgreSQL migration is still planned ([#15](https://github.com/Masterleeaus/Scheduled/issues/15), [#49](https://github.com/Masterleeaus/Scheduled/issues/49)). Do not claim booking parity until atomic availability, time zones, cancellations, checkout/recovery and payment callbacks pass executable tests ([#47](https://github.com/Masterleeaus/Scheduled/issues/47), [#58](https://github.com/Masterleeaus/Scheduled/issues/58)).
3. **Skilled** README documents Next.js 15/Express/Prisma and partial local build/migration checks as of Nov 8, but explicitly excludes a verified full stack, browser suite and live API/provider checks. It uses case-sensitive default branch `Main`. Published/permission-scoped competency and business knowledge boundaries must be validated ([#310](https://github.com/Masterleeaus/Skilled/issues/310), #311/#314).
4. **Central** README says pre-deployment and not a live production identity/entitlement service. Authentication, membership, signing, revocation, entitlement, two-company scoping, service loss and staging must pass inter-server release testing ([#160](https://github.com/Masterleeaus/Central/issues/160)).
5. **Sorted** currently identifies the outer app as Dovetails FSM and the installable field PWA as Sorted. Its `docs/canonical/PRODUCT_VISION.md` still names the field PWA `Titan Go` and needs reconciliation, tracked by [Sorted #29](https://github.com/Masterleeaus/Sorted/issues/29) / [#8](https://github.com/Masterleeaus/Sorted/issues/8). Preserve operational invoices and staff/teams during any consolidation.
6. **Supercharged** includes a broad inherited AI/telephony/marketing codebase, but README says these are not a production certification. Existing open PRs need reconciliation before trusting main as the integrated product; [#317](https://github.com/Masterleeaus/Supercharged/issues/317).

## Specific source-backed findings

### P0: URL-context privacy leak design — Website

`assets/tools.js` implements `toolContextUrl()` by adding `tool_context=JSON.stringify(context)` to pricing/support URLs. The same script carries business and service name assumptions. These values can land in history, request logs or referrer contexts even if the interface warns about them. [Issue #43](https://github.com/Masterleeaus/Titan-zero-website/issues/43) has a revised **9-task** checklist for eliminating PII-sensitive query handoff, validating schema/import/privacy, V2→V3 local data migrations, regressing no-URL-leak behaviour and proving source/published parity. **Not fixed yet.** [Source](https://github.com/Masterleeaus/Titan-zero-website/blob/main/assets/tools.js).

### P0: Secret-bearing appointment URLs — Supercharged

In `server/services/appointment-elevenlabs-tool.ts`, `getBookAppointmentWebhookTool()` embeds the appointment signing secret in the URL pathname when generating a provider webhook. A log/tracing exposure hazard is present by design; **specific real-world exposure is not established**. Created [issue #343](https://github.com/Masterleeaus/Supercharged/issues/343), requiring a secret-free URL and compatible signed header authentication, replay/freshness defense, tenant isolation, safe migration, provider tests and redaction. Distinguish from [#2](https://github.com/Masterleeaus/Supercharged/issues/2) (historical committed webhook secret files; rotation and history checks unverified). [Source](https://github.com/Masterleeaus/Supercharged/blob/main/server/services/appointment-elevenlabs-tool.ts).

### P0: License/provenance conflict — Supercharged

Source headers including `server/services/appointment-elevenlabs-tool.ts` declare **Envato/CodeCanyon** restrictions against redistribution, while root project metadata calls the repository **MIT**. This conflicts with a blanket MIT claim. Determine actual purchase/license and file-level rights before wider publishing. Already tracked by [issue #37](https://github.com/Masterleeaus/Supercharged/issues/37). No conclusion about legal rights is implied by the source alone.

### P1: Unauthenticated orphan backup route — Scheduled

`core/routes/web.php` defines a public `GET /backup` pointing at `Front\\FrontendController@backup`; the named FrontendController and inherited base Controller have no matching `backup()` method in inspected sources. This appears to be an orphan route; actual HTTP behaviour **was not** reproduced. Created [issue #76](https://github.com/Masterleeaus/Scheduled/issues/76) with tasks to reproduce, remove or secure, and test unauthorized access. [Route source](https://github.com/Masterleeaus/Scheduled/blob/main/core/routes/web.php).

### Additional current blockers

- [Scheduled #50](https://github.com/Masterleeaus/Scheduled/issues/50): issue reports fresh installation feature-migration manifest inconsistency; validate and fix as part of reproducible clean install.
- [Scheduled #51](https://github.com/Masterleeaus/Scheduled/issues/51): issue reports many first-party PHP tests skipped by default CI; expand and actually execute test coverage.
- [Scheduled #55](https://github.com/Masterleeaus/Scheduled/issues/55): issue documents 8 Cleanto API PHP files containing malformed Plivo class syntax (not independently linted in this scan); fix and run PHP lint before adopting code paths.
- [Central #156](https://github.com/Masterleeaus/Central/issues/156): implement one-plugin Free/Assistant/Agent Team entitlement policy, site/tenant signed capabilities, safe downgrade/no remote lock of local Free.
- [Supercharged #317](https://github.com/Masterleeaus/Supercharged/issues/317): reconcile competing PRs, required typechecking, migration and CI gates; no blanket PR merge.
- [Sorted #29](https://github.com/Masterleeaus/Sorted/issues/29): eliminate inconsistent old field app naming, respecting historically dated docs and compatibility-sensitive code.

## Cross-repository PR snapshot (not a merge recommendation)

At inspection: 30 open PRs among the seven active repositories (Website 1; Front Desk 1; Scheduled 2; Skilled 5; Central 1; Sorted 4; Supercharged 16). Some competing PRs may have been merged/closed since; review head-base conflict status and code before merger.

## Suggested execution order

1. **Protect privacy and secrets**: Website #43, Supercharged #343/#2/#37; audit every external-facing URL, logging path, upload and webhook. Rotate any confirmed exposed secrets via owner-controlled credentials.
2. **Make deterministic booking reliable**: Scheduled #15/#46/#47/#49/#50/#51/#55/#58, secure orphan #76; assert exactly one booking authority and real concurrency + payment tests.
3. **Prove product identity/authorisation**: Front Desk #45–#49, Central #156/#160, Skilled #310/#311, Sorted source-of-truth compatibility. End-to-end tenant/downgrade/consent tests.
4. **Resolve and test pending PRs**: especially Supercharged #317, Sorted CI PR #113, other release staging PRs.
5. **Certify production** only after clean installs, live-compatible integration tests in controlled staging, source/published parity, privacy/tenancy and rollback. Document actual pass/fail run identifiers.
6. **Closed-legacy governance audit**: verify historical completions against evidence rather than simply setting old boxes to done.

## What was actually done during this scan

- Enumerated repositories and linked issue backlogs; read representative source/README/workflow files and open pull request lists.
- Added issue-closure workflow protections to six active repos; website already had issue-closure rules. Concurrent housekeeping and backfill workflows from other work also updated the repositories. Current workflow files are the authority.
- Appended meaningful task checklists to selected missing issues; while this scan was in progress, automated/concurrent edits brought **all** active open issues to checklist coverage, plus historical Pro issues.
- Updated Website #43’s privacy checklist to nine independently verifiable tasks.
- Created source-backed Supercharged #343 and Scheduled #76.
- Ran the Front Desk closure test on issue #50: observed automatic reopen when unfinished and successful close once all three verification boxes were checked. No other issue was marked done without evidence by this audit.
- Read-only code scans were not a substitute for installing/building/deploying every repo. No production readiness was certified; no live systems or providers were modified.

**Policy:** Keep implementation evidence and tasks in the authoritative GitHub issue, check each item only when verified, and leave the issue open until every checkbox is checked.
