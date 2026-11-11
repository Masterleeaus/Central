# Shared Titan PostgreSQL database

This defines the target shared database contract for Titan Central, Sorted,
Supercharged, and LMS. The LMS source repository is `Masterleeaus/Skilled`.
PostgreSQL is the common database engine. This directory begins the new
clean-install migration chain. The existing `/migrations` chain remains the
active legacy source and continues to be tested separately; it must not be
removed or applied together with this clean-install chain.

## Canonical tenant rule

- `titan.companies.id` is the canonical company UUID.
- Every company-owned row in app schemas uses a non-null `company_id` UUID
  foreign key to `titan.companies(id)`.
- Shared identity and access records are in `titan.identities`,
  `titan.company_memberships`, `titan.application_entitlements`,
  `titan.application_company_links`, and `titan.application_user_links`.
- `titan.application_company_links` records each app's old tenant ID while it
  is migrated to the canonical company UUID.
- App-specific profile IDs remain text at the identity-link boundary to
  accommodate the current Sorted, LMS, and Supercharged ID formats.
- Truly global reference data must be identified in the table registry; nullable
  tenant IDs must not be used to represent tenant-owned data.

## Migration authority

Central owns the ordered migration registry. App repositories contribute
reviewed SQL migrations to this chain; app-local schema pushes must not mutate
shared production objects. Each migration is applied transactionally and
recorded in `titan.schema_migrations` with a SHA-256 checksum. A future runner
must serialize migration execution, reject checksum drift, and fail on an
unknown out-of-order migration.

## Current implementation boundary

Migration `0001_shared_company_core.sql` creates the shared core only. CI applies
it to a separate clean PostgreSQL database and checks the required company UUID
foreign keys. It does not yet move Sorted, LMS, or Supercharged domain tables,
change their database clients, or prove RLS isolation. Do not mark the four-app database
upgrade production-ready until those migrations and app adapters are completed
and verified on a disposable PostgreSQL database.

## Upgrade sequence

1. Freeze and inventory all four schema sources.
2. Reconcile shared entities and table-name collisions; assign each table an
   owner and tenant/global scope in `table-registry.csv`.
3. Port app-domain DDL into one ordered chain and establish schema namespaces.
4. Update app clients, sessions, route/worker context, and access policies to
   use the canonical company UUID.
5. Verify clean install, schema drift, and cross-company isolation for all apps.


## Reconciliation work added on the Central launcher draft branch

The PR #46 clean-install schema has been copied without modifying its original
`0001_shared_company_core.sql`. This repository now has two **independent**
database test paths: the legacy `/migrations` chain (1–15) and the canonical
`database/migrations` chain. CI applies each to a separate disposable
PostgreSQL database. Do **not** apply both chains to one database: both
create `titan.identities` with incompatible column contracts
(`state` versus `status`).

Canonical migrations added:
- `0002_shared_company_rls.sql` defines the company-scoped,
  NOLOGIN read-only role `titan_shared_company_reader`, transaction-local
  company context and FORCE RLS for company, identity, membership,
  entitlement and app-link reads. An unset or malformed scope reads no rows.
- `0003_legacy_central_company_links.sql` defines a reviewed one-to-one
  mapping from legacy Central organisation UUID to canonical company UUID
  and Logto organisation ID. Pending/revoked mappings never confer access.
  There is **no automatic conversion** between UUID namespaces.

Live deployment still needs an authenticated and audited mapping approval
workflow, schema-backfill procedures, shared database role grants and
production-level canonical RLS/provisioning. The existing launcher still
uses its legacy authoritative reader. Its queries have **not** been
switched to these canonical tables, because doing so before tenant and
identity migration would risk cross-company authorization errors.

These new draft migrations are not merged to PR #46 automatically;
the PR owners must reconcile the additional migration files before
either draft becomes production-ready.

## Verified canonical company-name bridge (additional staged integration)

- `0004_verified_company_lookup.sql` exposes only a restricted
  `resolve_verified_central_company(legacy_organisation_uuid, logto_organisation_id)`
  lookup to the canonical read role. It resolves **only** reviewed
  `verified` links for active companies. The authoritative Logto
  organisation ID must match the legacy mapping.
- `apps/control-api/src/central-canonical-company-name.mjs` uses that
  resolver and then changes the transaction-local `titan.company_id`
  before reading the canonical company name. It does not accept
  browser-provided display names or assume UUIDs are interchangeable.
- `central-shared-bootstrap.mjs` checks that a **separate named
  PostgreSQL database** exists and has the canonical tables and
  approved lookup function before handing the service a trusted name
  resolver.
- When the browser feature is enabled and no trusted name callback
  was injected, `server.mjs` now requires
  `TITAN_CENTRAL_SHARED_DATABASE_URL` and initializes a second
  connection pool. Both pools are closed on successful shutdown;
  failed canonical preflight closes its pool and blocks startup.
- `central-browser-router.mjs` validates
  `TITAN_OIDC_STATE_KEY` and injects the resulting AES-256-GCM
  sealer into both OIDC and company-choice stores. No implicit
  process-env key lookup replaces the supplied service environment.

**Critical limitations:** These are transitional staging mechanics,
not the final one-database architecture. Neither database has been
backfilled or linked with verified real user/company records.
Canonical migrations remain independent from the legacy migration
chain; do not run them on the same database. The newly created
`titan_shared_company_reader` role requires explicit, approved
role-membership grants for the canonical service credential, and
the legacy Central app credential requires its own previously
documented restricted roles. No production connections, migrations
or Logto registrations were changed.

## Canonical migration execution contract — Pass 13

Use `python3 tools/migrate_shared.py --database-url "$TITAN_SHARED_DATABASE_URL"`
**only** for the clean, separately named canonical database. The runner
executes `database/migrations/0001–0004` in order and records SHA-256
checksums in the canonical `titan.schema_migrations` table, not the
legacy `public.schema_migrations` registry. It reuses the established
migration parser, per-transaction advisory lock and `psql` error handling
but has a distinct lock ID and irreversible checksum-drift checks.

Safety guards:
- Existing legacy tables or legacy migration registry are refused before
  creating any canonical object.
- Applied version/name/checksum mismatches, removed migrations and
  out-of-order pending versions are fatal.
- The initial migration creates its own canonical ledger within the
  same transaction as the schema, and its ledger record is inserted
  **before COMMIT**, not later.
- A second execution is a no-op; `--dry-run` reports pending versions
  without installing any table.
- CI uses one disposable legacy Central PostgreSQL DB and one separate
  canonical DB. It proves the canonical runner cannot run against the
  legacy DB, checks its complete SHA-256 ledger, and executes both
  families' RLS tests independently.

The existence of one authoritative canonical migration runner does
**not** mean live tenant data has been moved. The ledger is unified
for the canonical core only. Legacy Central remains on its own 15-step
migration history while company/identity backfill, provisioning,
link approval, product data and schemas, and application adapters
await a reviewed transactional migration plan. Never silently
rename `titan.identities.state` to `status`, treat unrelated
UUIDs as equal or autoapprove legacy links.

## Read-only company reconciliation audit — Pass 14

Before approving any company/identity migration, run the standalone audit
against a stable, backed-up and access-restricted staging copy of both
databases:

```bash
python3 tools/audit_company_reconciliation.py \
  --legacy-url "$TITAN_CENTRAL_DATABASE_URL" \
  --canonical-url "$TITAN_CENTRAL_SHARED_DATABASE_URL" \
  --output /secure/titan-reconciliation-report.json
```

This tool performs **read-only, repeatable-read PostgreSQL transactions**
and caps each source table extraction at 10,000 rows, rejecting larger
datasets rather than silently publishing partial findings. It reads
legacy companies, Logto identities, memberships, legacy app entitlements
and local links, then compares them with canonical companies, verified
legacy-to-company mappings, identities, memberships, canonical app
entitlements and verified application user links. The explicit product
translation is `field → sorted`, `desk → supercharged`,
`academy → lms`.

The JSON report contains **only aggregate record counts and blocker
categories**, not company IDs, Logto subjects or user identifiers.
It flags missing/pending company mappings, mismatched Logto organisation
IDs, unmatched identities, roles and membership statuses, grant state
and feature differences, missing account links, and unexpected active
canonical memberships, entitlements or verified user links.
Exit codes: `0` for no discrepancies in compared fields, `2`
for review blockers, and `1` for unavailable/invalid/oversized
audit. The output path must not already exist.

**Not a migration authorisation:** The databases cannot provide one
atomic snapshot across two PostgreSQL instances. Each table is read
in its own read-only snapshot; run the audit against quiescent,
consistent staging copies. The current audit does not prove matching
expirations, audited Logto membership authority, production data
backfill completeness, approval of source mapping or product-specific
session semantics. Even exit `0` is not a substitute for signed
migration approval and a verified, rollback-safe conversion plan.

CI seeds *different* legacy and canonical company/identity UUIDs,
asserts that only verified mappings reconcile, then deliberately
changes a member role and requires a blocking exit. Unit tests
also cover unexpected canonical grants and local user links. No
production database is queried by CI.

## Pass 15 — Expiry reconciliation and staged cutover preflight

The read-only reconciliation audit now detects timezone-aware membership
and product-entitlement expiry mismatches, including unlimited versus
bounded access and invalid/naive timestamps. It allows at most a 1-second
difference in timestamp precision, and compares the active/expired result
at the same audit reference time. Critically, a pending or revoked
legacy-to-canonical link cannot be used to reconcile access records.

Snapshots have also been strengthened: **each entire database dataset**
is read under one PostgreSQL `REPEATABLE READ READ ONLY` transaction
rather than opening an individual transaction for each table. This
prevents changes within one database from mixing inconsistent table
versions. It still cannot provide a single atomic snapshot **between**
the legacy and canonical databases. Freeze source writes or use matching
point-in-time backups before drawing any operational conclusions.

The new `tools/plan_company_cutover.py` consumes the aggregate audit
JSON and produces a **non-mutating** approval preflight. Checks require
documented/restorable backups, quiescent sources, reviewed company
mappings, authoritative Logto memberships, product session compatibility,
rollback rehearsal, canonical RLS role verification and explicit
production change approval. An all-zero audit without those independent
checks is **blocked**. Even with every check marked true, the result
is only `ready_for_separate_human_review`: it always sets
`migration_authorised=false` and `writes_permitted=false`.

The full CI dataset test checks:
- Matching expiry states and timezone representations
- A canonical entitlement extended beyond the legacy expiry, which must block
- One snapshot per database, bounded extraction and unexpected record rejection
- A discrepancy-free report that must still fail the cutover preflight
- No production DB changes, schema conversions or backfill operations

This preflight intentionally does not create an apply command or
generate DML. A separate reviewed and reversible conversion plan
must exist before any future migration executor is authorised.

## Pass 16 — Deterministic staged-backfill candidate review and transaction rehearsal

`tools/plan_company_backfill.py` uses the read-only legacy and canonical
snapshot extraction to identify **candidate counts** for identities,
memberships, entitlements and application-user links. It emits no SQL DML,
identifiers, subjects or personally identifying rows, and never connects
with write privileges. It cannot approve a migration. Company mapping
requires a pre-existing **verified, exact Logto-matched and active**
legacy-to-canonical link; the planner **never creates a company** or
assumes legacy IDs equal canonical IDs. The planner blocks on
ambiguous/unverified/inactive mappings, missing canonical identity
provisioning, role/status/expiry/feature conflicts, duplicates and
unexpected active canonical rights. Existing canonical access records
are never silently overwritten, expanded or deleted.

A zero-conflict `candidate_review_only` output is still only a
review artifact. Missing canonical identities require independently
approved identity provisioning and a stable canonical UUID mapping
before membership/user-link candidates can be considered. It does
not validate externally controlled Logto or product account state.

`tests/sql/shared_backfill_rollback.sql` exercises identity →
membership → application-link FK ordering against a **disposable**
PostgreSQL canonical database, simulates a unique-key conflict,
and verifies that a full transaction rollback leaves **no identity
or access record** behind. The CI backfill step runs the planner
against its separate two-database test fixtures and checks
that no writes are authorised.

**Not a live migration tool:** No production backfill writer,
transactional cross-database coordinator, signed mapping approvals,
restorable backup evidence or tested rollback execution exists.
Do not execute the rehearsal SQL against a live database or
interpret a candidate count as permission to create access.

## Pass 17 — Signed, rolled-back identity/member rehearsal

`tools/rehearse_signed_backfill.py` exercises a **single, narrow
staging-only transaction**, not a production backfill. A private manifest
contains an existing canonical company UUID, reviewed legacy Central
organisation UUID, exact Logto organisation ID, a proposed new canonical
identity UUID, Logto subject and one membership role. A separate approval
artifact HMAC-SHA256-signs the **exact canonical JSON manifest digest**
with the domain `titan:staging-backfill-rehearsal:v1`, has a maximum
15-minute validity and is checked using constant-time signature matching.
Use a random 32-byte secret distinct from all login/OIDC secrets; never
commit or print it, the manifest or the approval file.

The CLI requires an explicit `--execute-staging-rehearsal`,
`TITAN_BACKFILL_STAGING_ENABLED=1`, a dedicated canonical staging DB name
and a valid approval. Inside a **SERIALIZABLE** transaction it acquires
an advisory lock; checks the exact, previously verified and still-active
company mapping; rejects duplicate identity IDs and Logto subjects;
then inserts one **new** canonical identity and one membership. It
**unconditionally ROLLBACKs**. There is no `COMMIT` path, no update,
no UPSERT, no implicit company creation, and no bulk data import.

CI signs a synthetic manifest with a throwaway key, runs the rehearsal
against its disposable `titan_shared_ci` database, then verifies both
identity and membership counts remain zero. Other tests reject expiry,
signature mismatch, changed roles, SQL injection, malformed IDs, missing
feature flags and non-staging database names. A failed SQL statement
cannot expose private row values in the CLI response.

**Deliberate limitations:** HMAC validates possession of a shared secret,
not an independently identifiable human signatory or a durable
approval audit. This rehearsal uses the CI/staging database credential;
a future actual backfill must use a minimally privileged restricted
writer, a durable signed and auditable approval record, a staged
idempotent/rollback procedure, stable source snapshots and verified
product/Logto policies. The rehearsal is not evidence that a
production migration can be executed safely, nor is it permission
to grant those write privileges.

## Pass 18 — Database-enforced staging-only writer with approval ledger

Migration `0005_staging_backfill_approvals.sql` extends the canonical
migration registry. It creates two durable tables:

- `titan.staging_backfill_approvals`: an operator-inserted, exact
  one-identity/one-membership approval specifying the **reviewed**
  legacy company UUID, canonical company UUID, exact Logto organisation ID,
  identity UUID and Logto subject, role, approver and change ticket;
  approval expires in at most 15 minutes and has a `consumed_at` marker.
- `titan.staging_backfill_audit`: a unique event linked to each consumed
  approval, recording company/identity UUIDs, authenticated database
  `session_user` and the committed staging outcome.

A new `titan_staging_backfill_executor NOLOGIN NOINHERIT` role gets
**EXECUTE on only** `titan.execute_staging_backfill_approval(uuid)`.
It receives no direct read/write privileges on approval, identity,
membership or audit tables, and no production credential is granted
this role automatically. The `SECURITY DEFINER` function runs with a
fixed search path and refuses execution unless the *actual PostgreSQL
database name* is on its small staging allowlist
(`titan_shared_ci`, `titan_shared_staging`,
`titan_shared_backfill_ci`). It locks one unconsumed,
unexpired approval, validates the exact mapping again against a
locked active company and verified link, refuses identity collision,
then inserts exactly one identity and membership, marks the approval
consumed, and appends one audit event in the **same database transaction**.

The **database administrator or separate privileged provisioning process**
must create the approval after independently validating evidence.
The executor itself has no ability to mint or edit approvals. This
database-enforced approval is distinct from the prior ephemeral HMAC
rehearsal; the HMAC rehearsal still always rolls back and cannot
produce approvals. Database approval rows currently contain
`approved_by` and ticket strings supplied by a privileged operator,
**not cryptographic evidence that a named human actually approved**.

CI verifies a committed staging transaction, approval replay denial,
expired and mismatched mapping refusals, and all-or-nothing rollback
(including the approval consumption and audit). It also connects using
a **real independently authenticated, non-superuser, NOINHERIT test
login**, asserts direct table reads and writes are forbidden, executes
only the narrow approved function via an explicit role change, and
checks the actual authenticated login is recorded in the audit.

**Safety boundary:** All committed operations in this pass execute only
against disposable CI PostgreSQL. A database *name* is defense in
depth, not a cryptographically proven environment identity: deploying
a production database under an allowed staging name would be unsafe.
The function is intentionally narrow and there is still **no
production backfill execution path**. Deployment requires separate
approval issuance controls, real independent human-signature
verification, least-privilege function ownership (the CI function is
installed by the schema owner), controlled staging credentials,
source freezes, rollback rehearsals and product/Logto verification.
Do not grant this execution role to any live production service.

## Pass 19 — Separate approval issuer, least-privilege function ownership, concurrency

Canonical migrations `0006`–`0011` extend the migration chain without
rewriting checksum-locked historical migrations:

- Dedicated **NOLOGIN, NOINHERIT** `titan_staging_approval_owner` and
  `titan_staging_backfill_owner` now own the respective
  `SECURITY DEFINER` functions. Neither role owns canonical tenant
  tables, bypasses RLS or retains schema `CREATE` privileges.
- A distinct **NOLOGIN** `titan_staging_approval_issuer` may execute
  only `titan.issue_staging_backfill_approval(...)`. The separate
  `titan_staging_backfill_executor` may consume an approval but cannot
  issue one. Neither role has direct table INSERT/SELECT privileges.
- The issuer function records the database-authenticated
  `session_user` as the approver (rather than accepting an arbitrary
  name) and checks the exact active, verified company mapping before
  creating a five-minute approval. The executor rechecks the mapping,
  locks and consumes the approval, and creates the identity, membership
  and audit event atomically.
- RLS policies constrain function-owner permissions. PostgreSQL
  requires specific column `UPDATE` grants and matching RLS policies
  for `SELECT ... FOR SHARE` row locks; the owner can only keep active
  company status active and verified link status verified, not change
  company identities or statuses. Extra `SELECT` privileges for
  `INSERT ... RETURNING` are limited to audit event and approval ID
  columns for their respective function owners.
- A consumed approval remains visible **only to the non-login owner**
  during row locking, so replay is explicitly rejected. Concurrent
  requests are serialized by the PostgreSQL row lock.

CI uses **two separately authenticated non-superuser PostgreSQL
logins**, proves approval issuance and consumption are distinct,
rejects attempts to cross the separation boundary, races two
execution attempts for the same approval, and requires **exactly one**
successful identity/member commit with exactly one audit event and an
approval attributed to the issuer's authenticated login. Database
login membership is created only in disposable CI; deployment must
provision logins and grants explicitly and separately.

**Still not production-authorized:** A database-authenticated approver
is not an independently human-signed approval. Database-name staging
allowlists do not prove an environment is non-production; real human
identity verification, independent change approval, least-privilege
provisioning, backups and real Logto/product source verification are
still required. No live production credentials or databases were used.

## Pass 20 — Approval and audit integrity checks (staging only)

Canonical migration `0012_staging_approval_integrity.sql` adds
fingerprints for the immutable fields of staging approval and committed
backfill audit records, using SHA-256 and domain-separated payloads.
Before-row triggers prevent ordinary database actors from modifying
approval details after issuance, deleting approvals, changing an audit
entry or deleting a committed audit. An approval may transition
`consumed_at` once, from NULL to its consumption timestamp; no other
approval fields may change. Existing rows get fingerprints during
migration.

The privileged, read-only `titan.verify_staging_backfill_integrity()`
function counts approval/audit fingerprints that no longer match and
checks that each consumed approval corresponds to an audit event.
The companion CLI
`tools/verify_staging_approval_integrity.py --database-url ...`
runs a single `REPEATABLE READ READ ONLY` transaction and outputs
aggregate counts **without user IDs, Logto subjects or customer names**.
Exit 0 means no mismatch in compared fields, 2 means a detected
integrity violation, and 1 means verification unavailable or invalid.

Disposable PostgreSQL integration tests verify that direct edits,
deletions and repeated consumption fail; a deliberately tampered approval
with the trigger temporarily disabled is detected and then restored
by rolling back the entire test transaction. The existing historical
expired-approval fixture was updated to seed its historical timestamps
on insertion rather than attempt an edit after creation.

**Security limits:** These SHA-256 fingerprints are *not independent
digital signatures*. A privileged PostgreSQL owner or superuser can
rewrite both rows and hashes or disable triggers. Independent,
person-bound, externally verifiable signed approvals and an off-database
tamper-evident checkpoint/receipt store are still missing. Existing
function owners and the privileged audit reader must be restricted
to appropriate staging contexts. No real production backfill is
authorised or executed by this mechanism.

## Pass 21 — Off-database Ed25519 staging execution receipts

`tools/staging_external_receipt.mjs` (Node.js 22, built-in crypto only)
captures a **previously committed** staging approval and audit pair,
signs it with an **external Ed25519 private key**, and later verifies it
against a **separately pinned public key** and a fresh read-only
PostgreSQL query. It is not a replacement for independent human
authorization to execute the migration. The signing key must remain
outside PostgreSQL and must never be committed to Git or logged.

The tool offers four commands:

- `capture --database-url URL --approval-id UUID --output receipt.json`
  requires a one-to-one approval/audit pair with equal company and
  identity IDs, consumed approval, committed audit result, and stored
  SHA-256 fingerprints that still match the current database rows.
  Only the stage-allowlisted database names are accepted.
- `sign --receipt receipt.json --private-key signer.pem --output signed.json`
  signs the exact canonical JSON receipt with a domain-separated
  Ed25519 signature. Outputs are created with restrictive file modes;
  existing files are **never overwritten**.
- `pin --public-key signer-public.pem` returns the SHA-256 fingerprint
  of the Ed25519 SubjectPublicKeyInfo DER bytes.
- `verify --signed signed.json --public-key signer-public.pem
  --trusted-key-sha256 PIN --database-url URL` first checks the
  independently supplied pinned key and signature, then compares
  all receipt database/approval/event/fingerprint fields with a
  new read-only database snapshot. The signature and database hashes
  must both match.

The external receipt contains an approval/event UUID pair, its
approval and audit SHA-256 fingerprints, a staged database class and
capture time. Treat it as **confidential** (the UUIDs permit
correlation). Store the signed receipt and its public-key pin in
independently administered, retention-protected storage **outside**
the database and its administrator's access. Merely writing the
receipt to the same host is **not** an independent audit store.
An independent storage retention policy, witness identity, revocation
policy and key rotation are required before operational reliance.

CI generates throwaway Ed25519 keys only in runner temporary space,
captures an actual disposable PostgreSQL staging commit, signs it,
checks verification with the known pin, and confirms that a wrong
public-key pin fails. It separately tests altered receipts, event
IDs, timestamps, digest values, unknown fields, invalid signatures
and output overwrite protection.

**Explicit limitation:** This is *after-the-fact cryptographic
attestation of a staging commit*. It does **not** prove that a named
human approved the action beforehand, nor does it stop a malicious
operator from making a valid-looking commit before receipt capture.
The signing key identity is only as trustworthy as the independently
maintained public-key pin and custody procedure. There is no new
production database write path or production cutover authorization.
