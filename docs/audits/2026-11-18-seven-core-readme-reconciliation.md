# Seven-core README and architecture reconciliation

**Date:** 18 November 2026 (Australia/Melbourne). **Scope:** `Masterleeaus/Scheduled`, `Sorted`, `Skilled`, `Supercharged`, `Central`, `Titan-Zero-Trades-Front-Desk`, `Titan-zero-website` — no other repositories.

## Method, boundaries and inventory

1. Retrieved the default-branch recursive Git tree of all seven repositories. There are **299 files with README-style names**: Scheduled 261, Sorted 8, Skilled 4, Supercharged 15, Central 7, Front Desk 3, website 1.
2. Inspected all seven original root READMEs, selected module/project README files, current architecture source `Central/TITAN_ARCHITECTURE_DECISIONS.md` (ADR-009), Front Desk's `docs/SINGLE-PLUGIN-AI-SERVICES-ARCHITECTURE.md`, Sorted's canonical Dovetails product/architecture, package manifests and publishing documentation.
3. Retrieved the **full available open-issue results** from all seven issue trackers (including checklist text), compared priorities, duplicate/completion status and conflicting desired architectures. These issues are **living trackers**, not proof of shipped behavior.
4. Wrote **seven substantive root README replacements** and **five subordinate README corrections**, including WordPress's public `readme.txt`.
5. Re-fetched all 12 changed documents after their commits and verified that all relative Markdown links in the seven root READMEs resolve to paths in the matching default-branch Git tree. This is a **source-link check**, not production deployment or exhaustive GitHub Actions validation.
6. Third-party `core/vendor`, `private/cleanto`, imported donor and licence readmes were **intentionally preserved**. Historical test-specific MySQL documents describe reproducible existing-source behaviour; they are not final-architecture installation directions. No code, migration, provider secret, package manifest or issue checkbox was changed in this documentation pass.

## Changes actually committed

| Repository | Changed document | Commit |
| --- | --- | --- |
| Scheduled | [Root README](https://github.com/Masterleeaus/Scheduled/blob/main/README.md) | [8bb64158](https://github.com/Masterleeaus/Scheduled/commit/8bb6415826183c77b003e3fe5cccb9315dd5ed4e) |
| Scheduled | [integration/README.md](https://github.com/Masterleeaus/Scheduled/blob/main/integration/README.md) | [10d8c50d](https://github.com/Masterleeaus/Scheduled/commit/10d8c50dd1c80a9e06733b70141d14d10d5f3626) |
| Sorted | [Root README](https://github.com/Masterleeaus/Sorted/blob/main/README.md) | [81e32209](https://github.com/Masterleeaus/Sorted/commit/81e32209f2bd875200c95a631791eff2ebc1f436) |
| Sorted | [docs/backlog/README.md](https://github.com/Masterleeaus/Sorted/blob/main/docs/backlog/README.md) | [bbd6d878](https://github.com/Masterleeaus/Sorted/commit/bbd6d878861e7f12826230528000d397ab9ec2e5) |
| Skilled | [Root README](https://github.com/Masterleeaus/Skilled/blob/Main/README.md) | [b80d883c](https://github.com/Masterleeaus/Skilled/commit/b80d883c9c04ed8952dff9bd869943c240675f2e) |
| Supercharged | [Root README](https://github.com/Masterleeaus/Supercharged/blob/main/README.md) | [1ee28b6d](https://github.com/Masterleeaus/Supercharged/commit/1ee28b6d2e7bb4f3e400994d0dc5a3c2f3b20967) |
| Central | [Root README](https://github.com/Masterleeaus/Central/blob/main/README.md) | [7cabceef](https://github.com/Masterleeaus/Central/commit/7cabceeffbaf25bb19b99c5a941baad8e0c1bd3d) |
| Central | [database/README.md](https://github.com/Masterleeaus/Central/blob/main/database/README.md) | [c41ccd9c](https://github.com/Masterleeaus/Central/commit/c41ccd9c79ecc3aaf9276c2cecd007b760373fed) |
| Central | [apps/launcher/README.md](https://github.com/Masterleeaus/Central/blob/main/apps/launcher/README.md) | [3734ccd5](https://github.com/Masterleeaus/Central/commit/3734ccd5b978be2713dfe37025e7570e3e79ceaf) |
| Front Desk | [Root README](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/README.md) | [4ac7bd68](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/commit/4ac7bd6891d968ef877663e6179242a6f6202cc8) |
| Front Desk | [WordPress readme.txt](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/titan-zero-trades-front-desk/readme.txt) | [c8d632a1](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/commit/c8d632a1a3355c83c555e72c54a7f447d1d9321e) |
| Website | [Root README](https://github.com/Masterleeaus/Titan-zero-website/blob/main/README.md) | [65000c38](https://github.com/Masterleeaus/Titan-zero-website/commit/65000c3836026cc1adddd8aaabeef2fccd9119c5) |

## Critical architectural corrections

- **Five-product integrated design:** Central, Scheduled, Sorted, Skilled and Supercharged target **one physical PostgreSQL database**, one migration authority, canonical company UUID and per-product least-privilege access; pre-cutover standalone DBs must not be presented as integrated deployment.
- **One booking authority:** Scheduled owns integrated booking/calendar; the standalone Free WordPress plugin remains locally functional. Dual-writable state is forbidden; cutover/reconciliation must be explicitly tested.
- **Front Desk packaging:** One installable **Scheduling & Enquiries Manager** plugin, optional hosted AI Assistant and Agent Team **inside** that install; no Pro ZIP, companion plugin or paid local PHP lock.
- **Product ownership:** Sorted jobs/quotes/invoices/field; Skilled curriculum/assessed competency; Supercharged communications/inbox/agents/connectors; Central shared company/identity and entitlement; Scheduled scheduling/websites.
- **Sorted product identity:** Dovetails canonical documents still assert a single-business product with `Titan Go`; README explicitly preserves the conflict with multi-company SortedAt.Work and identifies decisions required in Sorted #29/#26 and Central #140. No unsafe rename claimed.
- **Skilled baseline:** pnpm 10, Node 22+, Next.js 16, Prisma 6 and ESLint 10; real required CI lint and PostgreSQL-backed tests, with curriculum/security review still outstanding. Avoid stale Next 15/Node 20 badges.
- **Supercharged:** inherited feature catalogue, agent modules and vendor integrations are **not release certification**; full CI, webhook signing, company authorization, connector vault, source licensing and provider sandbox remain gates.
- **Website:** static `pages/*.html` source vs clean URL mirrors, `site-gate sync/check`, upgrade-catalogue authority and opt-in privacy; not a hosted product backend.
- **WordPress readme contradiction:** replaced an explicit `Hosted AI is on by default` statement, plus two claims that the same edition `does not use AI`, with wording that separates always-local booking from optional/uncertified hosted services. This is documentation and policy alignment **only**, not evidence runtime consent has been implemented.

## Verification and remaining work

- **Completed:** 12 GitHub source-document writes, 12 re-fetch checks, seven root-relative-link source checks (zero missing relative paths).
- **Not claimed:** tests of all external links, screenshot/browser rendering, deployment, live WordPress behaviour, five-app database cutover or closure of implementation issues.
- **Issue checklist discipline:** no `[ ]` implementation task was marked `[x]` as a result of README editing; no issue was closed.
- **Open concerns:** Central #140/#160; Sorted #29/#95/#100; Scheduled #46/#47/#49/#54; Skilled #300/#301/#302; Supercharged #317/#320/#343; Front Desk #45–#49 and new booking/QA regressions; website #21/#43/#46. Follow each owner issue for real runnable evidence.

This report is an index of a **documentation pass**, not an end-to-end technical audit of 299 files. All README paths were inventoried; selected first-party text was inspected and updated, and upstream/vendor README content was deliberately left untouched.
