# Seven core repositories — ESLint CI enforcement pass

Date: 2026-11-16 (Australia/Melbourne). Scope strictly limited to `Scheduled`, `Sorted`, `Skilled`, `Supercharged`, `Central`, `Titan-Zero-Trades-Front-Desk`, and `Titan-zero-website`.

## Verified change (Skilled #303)

The 2026-11-15 issue report alleging mismatched ESLint 9 vs 10 is obsolete in the current GitHub default branch. Read the actual files:

- `packages/eslint-config/package.json`: ESLint peer `^10.14.0`, `@eslint/js` dependency `^10.0.1`.
- `apps/backend/package.json`: ESLint `^10.14.0`, `@eslint/js` `^10.0.1`.
- `apps/frontend/package.json`: ESLint `^10.14.0`.
- `pnpm-lock.yaml`: the three importers resolve `eslint@10.15.0`; backend and shared config resolve `@eslint/js@10.0.1`; no `eslint@9` resolution is present.

This pass **implemented** protection against future recurrence:

1. New `Skilled/scripts/test-eslint-workspace-contract.mjs`, commit [5adbd8f6](https://github.com/Masterleeaus/Skilled/commit/5adbd8f6cf9ed3e565781389319ffc838a790223), checks manifest and lockfile ESLint ranges and intentionally mismatched negative fixtures.
2. Updated `Skilled/.github/workflows/skilled-ci-gates.yml`, commit [fdf03edf](https://github.com/Masterleeaus/Skilled/commit/fdf03edf6e5aa075d0782b13f4985ea6d79bcfee), adding the contract and actual root `pnpm run lint` (both backend and frontend) after mandatory frozen-lockfile installation.
3. **Exact push-head GitHub Actions run [43812601288](https://github.com/Masterleeaus/Skilled/actions/runs/43812601288) succeeded**. Its three jobs — `Contract scripts`, `Academy backend gates and test typecheck`, and `Backend vitest (with PostgreSQL)` — all succeeded. In `Contract scripts`, both new `Validate ESLint 10 workspace and lockfile contract` and `Lint backend and frontend with shared config` steps completed successfully.
4. [Skilled #303](https://github.com/Masterleeaus/Skilled/issues/303) was closed `completed` with six evidence-backed `[x]` tasks (6/6). Historical old scan text is retained outside the actionable checklist. No claim of live production deployment is made.

## Issue/PR snapshot after this pass

The following counts are an **instantaneous search result**, not a guaranteed isolated delta. Concurrent agents have been modifying these repositories.

| Repository | Open issues | Open PRs | Missing checklists | Checked / all live tasks |
|---|---:|---:|---:|---:|
| Scheduled | 25 | 2 | 0 | 13 / 167 |
| Sorted | 46 | 4 | 0 | 17 / 397 |
| Skilled | 54 | 5 | 0 | 16 / 450 |
| Supercharged | 52 | 18 | 0 | 25 / 486 |
| Central | 53 | 1 | 0 | 28 / 474 |
| Titan-Zero-Trades-Front-Desk | 44 | 1 | 0 | 2 / 556 |
| Titan-zero-website | 44 | 2 | 0 | 7 / 374 |
| **Total** | **318** | **33** | **0** | **108 / 2,904** |

The prior pass's snapshot was 317 open, 33-ish PRs, and 88 checked tasks. The net open-issue change **must not** be attributed solely to this pass, because other agents can create issues while this audit runs.

## Next safe owners (still open)

- **Sorted #100/#95:** migration prefix collisions and post-migration tenant-safe audit inserts; inspect environment ledgers rather than renaming potentially applied files.
- **Scheduled #54/#49/#76:** secret remediation and credential rotation review, PostgreSQL/Laravel booking cutover, and disposable HTTP route acceptance.
- **Skilled #301/#300:** deployed tenant/course/authorization and link/reply exposure negative checks; #303 is narrow tooling only.
- **Supercharged #317/#319/#320/#324:** integration/full CI, Plivo signed callbacks, route-guard audit, widget origin protections.
- **Central #140/#151/#160:** shared database, staging cutover and CI ephemeral credential policy.
- **Front Desk #45–#49:** single WordPress plugin plus hosted AI Assistant/Agent Team, no Pro ZIP.
- **Website #21/#43:** generated HTML parity and private data handoff controls.

Never mark a task complete based on code-review inference alone when it requires runnable test, integration, security, or production evidence.
