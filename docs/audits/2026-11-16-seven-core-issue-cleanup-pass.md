# Seven-core GitHub issues — security regression cleanup pass

Date: 2026-11-16 (Australia/Melbourne)

Scope is **only**: `Scheduled`, `Sorted`, `Skilled`, `Supercharged`, `Central`, `Titan-Zero-Trades-Front-Desk` and `Titan-zero-website`.

## Executed and evidenced

1. Added `Supercharged/.github/workflows/security-source-contracts.yml` on default `main` at commit [f8969810](https://github.com/Masterleeaus/Supercharged/commit/f8969810c8bde39cc0eeb982473dcb5a5cb864fa).
2. The workflow runs existing dependency-free static security regression tests for plugin enablement, company-scoped RAG search and Plivo voice callback registration, using Node 22 on relevant source-test changes.
3. Exact-head [GitHub Actions run 43809865598](https://github.com/Masterleeaus/Supercharged/actions/runs/43809865598) **passed**. Job `Verify source security contracts`, step `Run scoped, dependency-free security regressions`, both reported success. This is focused, source-level acceptance, not an end-to-end live-provider or database integration suite.
4. Closed [Supercharged #321](https://github.com/Masterleeaus/Supercharged/issues/321) (obsolete plugin-loader test fragment) and [#322](https://github.com/Masterleeaus/Supercharged/issues/322) (obsolete RAG catch-binding test fragment) as **completed**, after replacing their generic scan-derived task lists with five verified checklist tasks each. Their underlying source/test corrections existed on main before this pass; this pass supplied durable CI evidence and issue completion.
5. Updated [Supercharged #319](https://github.com/Masterleeaus/Supercharged/issues/319) and [#317](https://github.com/Masterleeaus/Supercharged/issues/317) with the passing **narrow** CI evidence. Both remain open: Plivo provider signature/replay/real HTTP tests and full merge/migration/CI/typecheck acceptance are not covered by this workflow.

## Seven-repository live issue snapshot

Measured from GitHub open issue search after this pass. Counts are affected by other concurrent agents; treat as a point-in-time snapshot rather than this pass's isolated delta.

| Core repository | Open issues | Missing task checklists | Checked / total live checklist tasks |
|---|---:|---:|---:|
| Scheduled | 25 | 0 | 13 / 167 |
| Sorted | 44 | 0 | 10 / 384 |
| Skilled | 55 | 0 | 14 / 460 |
| Supercharged | 52 | 0 | 25 / 486 |
| Central | 53 | 0 | 17 / 470 |
| Titan-Zero-Trades-Front-Desk | 44 | 0 | 2 / 556 |
| Titan-zero-website | 44 | 0 | 7 / 374 |
| **Total** | **317** | **0** | **88 / 2,897** |

## Still blocking safe implementation closure

- **Supercharged #317 / #319 / #323 / #324:** Resolve the full repository CI failures, Plivo authenticated callback acceptance, actual strict RAG typecheck and widget session-start rules. Do not close from static tests alone.
- **Scheduled #54 / #76 / #49:** Gateway credential remediation and rotation review, disposable HTTP backup-route smoke, and integrated PostgreSQL/OIDC cutover.
- **Sorted #95 / #100:** Verify applied migration ledgers and PostgreSQL audit/RLS before changing or certifying migration numbering.
- **Skilled #301 / #300 / #303:** Class-list and discussion tenant/authorization integration, and workspace ESLint major alignment.
- **Central #140 / #151 / #160:** One-database migration, CI-only credential policy and complete staging release acceptance.
- **Front Desk #45–#49:** One WordPress plugin, hosted AI service contracts, downgrade, consent and booking continuity.
- **Website #21 / #43:** Static release gate and remaining consented handoff/privacy acceptance.

## Evidence policy

- A checkbox is `[x]` only for a verifiable, scoped completed act. Legacy historical tasks can be archived rather than falsely checked; unresolved implementation must be kept in the active owner.
- A targeted green test does not substitute for application-wide CI, a disposable migrated database, real tenant boundary checks or live provider/deployment acceptance.
- No claims about production deployment, external secret rotation or live account behavior are made in this report.
