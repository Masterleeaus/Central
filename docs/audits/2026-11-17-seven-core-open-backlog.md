# Seven-core outstanding issues and task register — 2026-11-17

This is a point-in-time GitHub **open-issues** inventory, not a claim that a completed checkbox was independently verified here. Updated by the seven-core audit; later concurrent writes can change it.

| Repository | Open issues | Open PRs | Live checklist completed | Live checklist unchecked | Missing issue checklists |
|---|---:|---:|---:|---:|---:|
| Scheduled | 25 | 2 | 13 | 154 | 0 |
| Sorted | 46 | 4 | 17 | 380 | 0 |
| Skilled | 54 | 18 | 16 | 434 | 0 |
| Supercharged | 69 | 25 | 49 | 517 | 0 |
| Central | 53 | 1 | 28 | 446 | 0 |
| Titan-Zero-Trades-Front-Desk | 45 | 22 | 153 | 409 | 0 |
| Titan-zero-website | 44 | 2 | 7 | 367 | 0 |
| **Total** | **336** | **74** | **283** | **2,707** | **0** |

Counting rule: each open issue's Markdown list items `- [ ]`, `- [x]`, `* [ ]`, `+ [x]` and numbered checkbox equivalents outside quoted historical text. Closed issues' completed tasks do not contribute to this table, so the 283 checked tasks is **not all project work ever completed**.

## Current blockers requiring real implementation / evidence

1. [Sorted #100](https://github.com/Masterleeaus/Sorted/issues/100) and [#95](https://github.com/Masterleeaus/Sorted/issues/95): 209/210 migration-prefix collision, migration-ledger deployment history, PostgreSQL audit table writer/RLS.
2. [Scheduled #54](https://github.com/Masterleeaus/Scheduled/issues/54), [#49](https://github.com/Masterleeaus/Scheduled/issues/49), and [#76](https://github.com/Masterleeaus/Scheduled/issues/76): gateway credential remediation; Laravel/PostgreSQL cutover and booking runtime; disposable unauthenticated backup-route check.
3. [Skilled #300](https://github.com/Masterleeaus/Skilled/issues/300) and [#301](https://github.com/Masterleeaus/Skilled/issues/301): production-like tenant access on discussion and live-class reads and writes.
4. [Supercharged #317](https://github.com/Masterleeaus/Supercharged/issues/317), [#320](https://github.com/Masterleeaus/Supercharged/issues/320), and [#324](https://github.com/Masterleeaus/Supercharged/issues/324): full application CI red; 130 route-auth classifications remained at the previous verified PR #348; origin checks must not be mistaken for cryptographic identity. Since then, 2026-11-17 pull-request checks have continued to fail, see [run 44008433467](https://github.com/Masterleeaus/Supercharged/actions/runs/44008433467).
5. [Central #140](https://github.com/Masterleeaus/Central/issues/140), [#151](https://github.com/Masterleeaus/Central/issues/151), and [#160](https://github.com/Masterleeaus/Central/issues/160): shared-DB migration staging, throwaway CI credential policy and full release cutover.
6. [Front Desk #45](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/issues/45): one installable WordPress Scheduling & Enquiries Manager plugin. Former Pro is reference only; Assistant and Agent Team are optional hosted subscription services.
7. [Website #43](https://github.com/Masterleeaus/Titan-zero-website/issues/43) and [#21](https://github.com/Masterleeaus/Titan-zero-website/issues/21): privacy-safe tool handoff and static source-to-generated parity.

## Explicit constraints

- Never mark an implementation or test task complete without evidence.
- Before closing a duplicate, transfer unique outstanding acceptance work to a canonical open checklist.
- Do not rename migration files already applied in any environment, and do not assert any ledger has been checked until inspected.
- Source-only static checks do not establish provider, database or deployment readiness.
- Never include out-of-scope repositories in this register.
