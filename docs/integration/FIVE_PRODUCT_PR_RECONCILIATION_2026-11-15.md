# Five-product PR reconciliation — 2026-11-15

Status: **source-verified triage; no code merge or runtime acceptance implied**. Refs Central #82, #83, #103, #105. This document is an execution order, not authority to bypass CI or branch protection. Default branches: Skilled `Main`, all others `main`.

## Snapshot

| Repository | Open PRs | Merge queue |
| --- | ---: | --- |
| Skilled | 4 | #264; #278/#279 content; #285 mapping |
| Scheduled | 0 | Database and integration work in issues #7/#15 |
| Sorted | 8 | #55/#32; #66/#63/#65/#68/#73; independently review #54 |
| Central | 0 | No open PRs at inspection |
| Supercharged | 16 | Migration and SSO chain before independent refactors |

All 28 open PRs reported `mergeable=false` in the preceding GitHub inspection. That Boolean does not establish the *cause* for each PR. Supercharged #307 was actually attempted and rejected by GitHub 405 as conflicting. Recheck current heads, branch protections and checks before any mutation.

## Sorted: overlapping changes, concrete filenames

1. **Core library consolidation:** #66 adds the `packages/central-client` core; #63 adds `src/link-assertion.ts`; #65 adds `src/service-token.ts` and `src/entitlements.ts`. #73 includes **all of those paths**, their tests, package metadata and the lockfile, plus `apps/web/app/api/central/{sign-in,callback}`. Compare each earlier branch's behavior/tests against #73 *before* selecting #73 as the consolidation candidate. Don't merge all four sequentially.
2. **Contract harness:** #68 adds fixture-driven checks under `packages/central-client/test/contract`, but also changes `package.json`, Vitest config and lockfile. Merge its independent tests **after** selecting the production client candidate; regenerate lockfile once and run all contract tests.
3. **Competing auth adapter:** #54 implements `apps/web/app/auth/titan/*` and `apps/web/lib/central/*`; #73 implements `apps/web/app/api/central/*` and a package client. They appear to be alternative login entrypoints. Choose one user-facing login/callback/session architecture, verify CSRF/PKCE, revocation, company selection, audiences, and preserve unique events/flags tests.
4. **Intake carry:** #55 explicitly carries #32's ~106-file intake/backup work and adds `docs/working/carry-32-merge-decisions.md`. Use #55 as the reconciliation *candidate*, not proof of complete equivalence. Verify unique changes in #32 by diff and run real PostgreSQL integration, migration #209, private media, restore and backup tests. If #55 passes and covers #32, close #32 as superseded with precise links rather than merge twice.
5. **Known gate:** #55 documents two manifest checksum drifts also on its base, and unrun PostgreSQL/complete gate checks. Neither should be hidden by dropping checks.

## Skilled: dependencies

1. #278 adds draft nutrition lesson files and updates normalization/review queue; #279 similarly adds short-stay host drafts. Both edit `curriculum/lesson-normalization-index.json` and `curriculum/lesson-review-queue.json`.
2. #285 adds course mapping and draft files including the nutrition/short-stay paths, plus mapping CSV/JSON, six level maps, backend level mapping and a regression test. Inspect its draft lesson revisions against #278/#279; preserve content, then *regenerate* derived mappings/queue from canonical sources and run curriculum gates. Keep drafts unpublished pending human approval.
3. #264 changes authentication service/controller/token helper, Prisma schema and migration. The base already has `20261115090000_refresh_token_replaced_at`; compare this with #264's `20261115100000_refresh_token_family` before migrating. Validate refresh-token replay family revocation, recovery token hashing, upgrade/rollback and API tests.

## Supercharged: collision blockers

**Distinct PRs choose the same migration numbers or shared registry files:**

| PR | Migration(s) | Overlap |
| --- | --- | --- |
| #274 | `0018_website_widgets_company_id.sql` | #278/#283 also use 0018 |
| #278 | `0018_inbox_tenant_rls.sql` | #274/#283 |
| #283 | `0018_central_sso_company_links.sql`, `0019_central_sso_pending_logins.sql` | #274/#278; #284 pending-store overlap |
| #284 | `0020_scheduled_booking_mirror.sql`, `0021_central_sso_pending_seal.sql` | overlaps #283's `pending-store-db.ts` and test |
| #277 | `0022_comms_suppressions.sql` | #289 also uses 0022 |
| #289 | `0022_marketing_tables_tenant_rls.sql` | #277 also uses 0022 |

All six modify the migration journal or runner, except individual differences in application code. Do **not** merge as-is. Select one ordered *Central-governed* migration sequence, rewrite unique versioned entries without changing previously deployed migrations, reconcile the journal/runner, then test empty database, upgrade, rollback/restore, tenant RLS and idempotency under PostgreSQL. Inventory any applied migration records first; *never renumber an applied migration blindly*. See Supercharged #51, #197, #250–254 and Central #82.

- #307 proposes `shared/schema.ts` type cast while `main` already uses a more specific `$inferInsert`-based wrapper; GitHub rejected a merge. #296 also changes `shared/schema.ts` plus typecheck CI. Preserve the stronger current behavior; independently port useful required-check configuration after validation. Don't overwrite `main` with the older `Record<string, ZodType<any>>` cast.
- #284 describes itself as a consolidation of earlier Central SSO + Scheduled mirror work. Compare against #283 before adopting both.
- #304 (client pages), #299 (server engines), #287 (server routes), #286 (client components), #271 (route splitting), #264 (admin splitting), #236 (license headers), #231 (reply runtime) require normal head-vs-main diffs and full affected typecheck/tests. #236 affects hundreds of licensed files: provenance/legal check before changing headers.
- Reconcile all remaining PRs #277, #278, #274, #289 and #283 only after the migration baseline is established.

## Merge acceptance gate for *every* PR

1. Capture current base SHA and exact PR head SHA; fetch changed filenames and patch, verify unique additions against current `main`.
2. Classify as **independent**, **stacked**, **consolidated**, **superseded**, **conflicting** or **owner decision**; no closure based only on title.
3. Resolve changes on the PR branch or a new integration branch without `force` updates to default branches; preserve both meaningful change sets.
4. Review schema ownership and applied migration state; no application-specific database changes without Central registry agreement.
5. Run focused tests and required checks plus native PostgreSQL multi-company isolation tests for data/auth changes. Record actual commands and results.
6. Confirm no existing approval requirement or secret/licence policy is bypassed; merge only when GitHub accepts with expected head SHA.
7. Re-query state afterward; close a superseded PR only when its functionality is provably incorporated, and leave a traceable explanation.

## Work order

- **A:** Remediate publicly tracked secrets (Supercharged #2) and confidential archives (Sorted #34, Supercharged #133), with real secret rotation where exposure is proven. No source archive deletion before provenance/secret review.
- **B:** Resolve Central's canonical ID/entitlement and dual-mode database contracts (#82, #83, #103–105).
- **C:** Reconcile Sorted client/auth chain; Skilled draft chain; Supercharged schema and migration chains.
- **D:** Ship focused tests and merge eligible PRs with commit IDs, preserving the verification report.
- **E:** Run five standalone acceptance gates and unified end-to-end journeys before declaring production readiness.

This file does not certify any production deploy and does not alter product code.
