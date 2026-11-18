# Titan Central — shared identity, company authority and integration control plane

**Repository:** `Masterleeaus/Central` · **Documentation review:** 18 November 2026

Titan Central is the control plane for **five integrated products**: Central itself, ScheduledAt.Work, SortedAt.Work, SkilledAt.Work and SuperchargedAt.Work. It uses **Logto** as the identity provider. Central owns verified company context, membership/role decisions, service identity, entitlement policy, product links, signed handoffs, tenant-aware audit and the shared-database migration authority.

**State:** an implemented and extensively tested source foundation, **not a certified five-product production cutover**. An old `titan_central`-only database or three-app launcher is a historical transitional configuration, not the target in [ADR-009](TITAN_ARCHITECTURE_DECISIONS.md).

## Authority and service boundaries

| System | Authoritative responsibility | Hard rule |
| --- | --- | --- |
| **Central** | Logto/OIDC coordination, canonical company UUID, membership, entitlements, app identities/audiences, shared migration ledger and cross-app governance | Access is checked at service and tenant boundaries; never use email alone as company proof |
| **Scheduled** | Booking, calendar, inventory of available time slots, booking changes and website/landing-page publication | Only deterministic booking authority can commit a slot |
| **Sorted** | Jobs/visits, customers/property history, quotes, invoices and staff/field task records | Preserve quote/approval and business data provenance |
| **Skilled** | Courses, content publication, learning, assessment and verified competencies | Evidence and assessor approval precede competency claims |
| **Supercharged** | Business communications, AI-assisted conversations, workflow/agent execution and connector orchestration | Agent tools are scoped, audited, consent-aware; no booking bypass |

The **Scheduling & Enquiries Manager** Free WordPress plugin is an additional, locally usable product interface, **not a sixth independently logged-in database authority**. Its optional hosted Assistant and Agent Team pair with Central entitlement/consent services, without a separate Pro plugin. In integrated mode it calls Scheduled's authoritative booking interfaces; in standalone mode its locally working booking engine must remain useful.

## One-database design: target, not yet migration evidence

[ADR-009](TITAN_ARCHITECTURE_DECISIONS.md) requires:

- **One physical PostgreSQL database**, not separate product databases on the same host.
- Canonical `company_id` UUID across every company-owned business row, with membership and row-level isolation tested against **two real disposable companies**.
- A single centrally governed, ordered, checksum-verified migration ledger and advisory-locking rollout; product databases, Prisma/Drizzle/SQL or installer migrations are **not** independent production authorities.
- Separate least-privilege service roles and OIDC client audiences; no shared application secret and no alternate integrated-mode login.
- Explicit signed/idempotent cross-app event or decision contracts, bounded replay windows, revocation and failure-mode reconciliation.

**Do not treat historical README references to `titan_central` as proof that the five apps share that one database.** Applied migrations must never be rewritten, and none of the multi-app cutover tasks may be checked without staging evidence. See [#140](https://github.com/Masterleeaus/Central/issues/140), [#141](https://github.com/Masterleeaus/Central/issues/141), [#142](https://github.com/Masterleeaus/Central/issues/142) and [#160](https://github.com/Masterleeaus/Central/issues/160).

## Runtime and source map

| Path | Responsibility |
| --- | --- |
| `apps/control-api/` | Node.js 22 ESM API: token/access verification, account linking, revocation and company/entitlement services |
| `apps/launcher/` | Central browser login, company selection and product launcher |
| `packages/control-plane/` | TypeScript authorization, registry, events and policy contracts; source in `src/`, generated `dist/` |
| `packages/config-engine/` | Feature flags / configuration evaluation, **not** an authorization substitute |
| `migrations/` | Existing ordered Central SQL migration history; future shared schema changes require one coordinated ledger |
| `tools/migrate.py` | Version/checksum-verified migration runner; inspect actual environment ledgers before applying |
| `deploy/` | Example staging config, preflight, proxy configuration and operational gates |
| `tests/` | Conformance, security, migration, two-company PostgreSQL and test harnesses |

Compatibility-sensitive `field`, `desk`, `academy` and related stored app IDs may map to Sorted, Supercharged and Skilled. **Do not rename these in tokens, DB or routes until a versioned migration is proved.** Scheduled has a distinct product registry/audience contract ([#100](https://github.com/Masterleeaus/Central/issues/100)).

## Developer workflow and required evidence

```bash
npm ci
npm run build
npm test
npm run test:preflight
# Disposable test database only:
python3 tools/migrate.py --database-url "$TITAN_TEST_DATABASE_URL" --dry-run
```

Use a specifically provisioned **throwaway** PostgreSQL 16 instance for SQL/tenancy integration. The root test script runs scheduled booking/event conformance, control-plane and launcher tests. `packages/control-plane/dist/` is committed build output; rebuild it after changing `src/` and let CI check freshness. Do not put actual passwords or production credentials into the README, example commands, code or CI fixtures.

The currently documented [migration source](migrations/) and [database notes](database/README.md) are a **Central foundation**. They must be reconciled against the live target and exact applied ledger before switching any app to shared storage.

## Issue-driven release blockers

1. **[Shared DB #140](https://github.com/Masterleeaus/Central/issues/140)**, [#43](https://github.com/Masterleeaus/Central/issues/43): canonical company schema, ordered migrations and RLS.
2. **[Unified login #141](https://github.com/Masterleeaus/Central/issues/141)**, [#98](https://github.com/Masterleeaus/Central/issues/98), [#99](https://github.com/Masterleeaus/Central/issues/99): each product's Logto/OIDC and M2M audience/credentials; global logout and revocation.
3. **[Staging go/no-go #160](https://github.com/Masterleeaus/Central/issues/160)**, [#142](https://github.com/Masterleeaus/Central/issues/142): cross-repository acceptance for one shared PostgreSQL database, Central login/entitlements, Front Desk-to-Supercharged AI, product ownership, tenant denial, outage fallback, staging and rollback.
4. **[Front Desk hosted service epic #149](https://github.com/Masterleeaus/Central/issues/149)**, [#152](https://github.com/Masterleeaus/Central/issues/152), [#153](https://github.com/Masterleeaus/Central/issues/153), [#156](https://github.com/Masterleeaus/Central/issues/156): single-plugin pairing, subscribed hosted services, billing, approval, rate/abuse control and receipts. Supercharged [#489](https://github.com/Masterleeaus/Supercharged/issues/489) tracks the real Assistant and Agent Team capability sets for each of the nine WordPress plugins listed on the website; those eight planned plugins stay planned until implementation and tests are verified.
5. **[CI credential policy #151](https://github.com/Masterleeaus/Central/issues/151)** and [cross-app service contracts #103](https://github.com/Masterleeaus/Central/issues/103): avoid source-committed passwords, preserve deterministic contract fixtures and strict tenant audit.

Evidence of merged source fixes (such as [Scheduled inbound freshness #146](https://github.com/Masterleeaus/Central/issues/146)) does **not** imply cross-product staging or production release acceptance.

## Working agreement

Read [TITAN_ARCHITECTURE_DECISIONS.md](TITAN_ARCHITECTURE_DECISIONS.md), [deployment operations](deploy/OPERATIONS.md), [event contracts](docs/EVENTS.md), [service subscriptions](docs/SUBSCRIPTIONS.md), [control-plane details](packages/control-plane/README.md) and [the seven-core audits](docs/audits/). Every [open issue](https://github.com/Masterleeaus/Central/issues?q=is%3Aissue+is%3Aopen) has an actionable task checklist. Check `[x]` only for verified implementation and tests; close only with complete acceptance. Keep Logto upstream separate, never edit applied migrations and do not claim deployment on the basis of passing unit tests alone.

## Find every README and developer guide

- **[Complete README directory](docs/README_DIRECTORY.md)** — direct links to every README-style file in this repository, including component, test, vendor and historical documentation.
- **[Documentation index](docs/README.md)** — curated entry point to the main technical guides and developer workflows.
- **[Seven-repository platform map](https://github.com/Masterleeaus/Central/blob/main/docs/PLATFORM_MAP.md)** — cross-product architecture, ownership and integration boundaries.
