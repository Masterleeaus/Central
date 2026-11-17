# Titan Zero — seven-repository platform map

> **Architecture guide, 18 November 2026.** This describes the intended system and documentation ownership, not proof of deployment or production readiness. Check each repository's current code, open issues, CI and staging evidence before asserting that a feature works.

## Start here

Titan Zero is a connected service-business platform. The **five integrated application products** are Central, Scheduled, Sorted, Skilled and Supercharged. The **seven core repositories** additionally include the standalone-capable Front Desk WordPress plugin and the Titan Zero marketing website. Do not mistake seven repositories for seven independent databases or identity providers.

| Repository | Responsibility | Start reading |
| --- | --- | --- |
| [Central](https://github.com/Masterleeaus/Central) | Identity, verified company context, entitlements, shared PostgreSQL migration governance and cross-product contracts. | [README](https://github.com/Masterleeaus/Central/blob/main/README.md) |
| [Scheduled](https://github.com/Masterleeaus/Scheduled) | Laravel booking and calendar authority plus website and landing-page building; inherited Cleanto/PlusAgency source is transitional. | [README](https://github.com/Masterleeaus/Scheduled/blob/main/README.md) |
| [Sorted](https://github.com/Masterleeaus/Sorted) | Jobs, visits, quotes, invoices, customers, staff and field operations. | [README](https://github.com/Masterleeaus/Sorted/blob/main/README.md) |
| [Skilled](https://github.com/Masterleeaus/Skilled) | Curriculum, course delivery, assessments, competencies and learning evidence. | [README](https://github.com/Masterleeaus/Skilled/blob/main/README.md) |
| [Supercharged](https://github.com/Masterleeaus/Supercharged) | AI workforce, communications, connectors, audited workflow execution and automation. | [README](https://github.com/Masterleeaus/Supercharged/blob/main/README.md) |
| [Titan-Zero-Trades-Front-Desk](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk) | Single WordPress Front Desk plugin; local free booking remains functional, hosted integrations require explicit authority cutover. | [README](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/README.md) |
| [Titan-zero-website](https://github.com/Masterleeaus/Titan-zero-website) | Titan Zero public product, acquisition and commercial website; not an operational booking or identity authority. | [README](https://github.com/Masterleeaus/Titan-zero-website/blob/main/README.md) |

## Authority boundaries

1. **Central**: Logto/OIDC coordination, canonical company UUID, membership, entitlements, product/service access and shared migration authority. It does not own booking, jobs or learning records.
2. **Scheduled**: the **single integrated booking/calendar authority**. Its target is one Laravel application. Historical Cleanto sidecars, MySQL harnesses and duplicate booking writers are not the target production architecture.
3. **Sorted**: operational jobs, visits, customers, staff, quotes and invoices. Booking confirmations must come from Scheduled, not a competing availability writer.
4. **Skilled**: training content, learner progression, assessment and verified competence; never infer a qualification from an unapproved draft.
5. **Supercharged**: communications, AI agents, automation and connector execution; AI may recommend actions but must not bypass deterministic authorization, booking or payment enforcement.
6. **Front Desk**: one WordPress plugin, not separate Free/Pro installations. Its local booking mode must work independently; integrated booking mode needs explicit authority negotiation and tested cutover to Scheduled.
7. **Titan Zero Website**: customer-facing presentation and acquisition. It must not become a parallel system of record.

## Data and authentication target

Central [ADR-009](https://github.com/Masterleeaus/Central/blob/main/TITAN_ARCHITECTURE_DECISIONS.md) specifies **one physical PostgreSQL database** for the five integrated applications, with a centrally governed ordered migration ledger, canonical `company_id` UUID, least-privilege service roles and cross-company isolation. Logto-backed OIDC governs integrated sign-in. This is a **target requiring migration, CI and staging proof**, not an assertion that all five codebases have already cut over. Do not apply legacy and canonical migration chains together or change applied migration checksums.

## How a business operation crosses products

**Customer enquiry → Front Desk/Supercharged → Scheduled booking decision → Sorted job/visit → Skilled competency verification (where required) → Supercharged notifications.** Central validates identity, company context and entitlements at each service boundary. Commands/events need versioning, idempotency, audit, retry/reconciliation and permission checks. An AI recommendation never reserves a slot by itself.

## Documentation hierarchy

1. Central architecture decisions and each repository's root README establish current product boundaries.
2. Current source, migrations, contracts, automated tests and deployment evidence establish what is actually implemented.
3. Component README files document exact installation, commands, API and local constraints. A component README must link to its root README and mark historical assumptions.
4. GitHub issues hold active task checklists and acceptance evidence. Do not treat historical backlog or pass reports as competing live task authorities.
5. Vendor READMEs, licences, archived handoffs and historical test reports are retained for provenance; they do not define Titan Zero architecture.

## Where to look next

- [Central architecture decisions](https://github.com/Masterleeaus/Central/blob/main/TITAN_ARCHITECTURE_DECISIONS.md)
- [Central deployment operations](https://github.com/Masterleeaus/Central/blob/main/deploy/OPERATIONS.md)
- [Sorted canonical architecture](https://github.com/Masterleeaus/Sorted/blob/main/docs/canonical/ARCHITECTURE.md)
- [Sorted deployment runbook](https://github.com/Masterleeaus/Sorted/blob/main/docs/DEPLOYMENT_RUNBOOK.md)
- [Skilled deployment](https://github.com/Masterleeaus/Skilled/blob/main/docs/DEPLOYMENT.md)
- [Supercharged installation](https://github.com/Masterleeaus/Supercharged/blob/main/INSTALLATION.md)
- [Front Desk runtime test guide](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/tests/runtime/README.md)

## Developer checklist before changes

- Identify the authoritative product and source of truth; do not add a duplicate writer or login.
- Check open issues and the relevant current component documentation.
- Verify migration order, tenancy, authorization and external-service failure behaviour.
- Test changes in disposable environments and record the actual evidence; distinguish skipped tests from passes.
- Mark issue checklist items complete only after verification; close an issue only when all required tasks are checked.
- Update the root README, component README and platform map together if an approved architectural boundary changes.
