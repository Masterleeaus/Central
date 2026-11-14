# Retention policy (partly decided)

Status: PARTLY DECIDED. The owner has decided a retention period of **1 year** for audit rows (section 1)
and for activity history (section 6). Nothing else in this document is settled policy. Items marked **TO DECIDE**
need a legal, privacy or owner decision before they are implemented or relied on. Items marked **CURRENT** describe
behaviour that the code already has. A purge job exists (`tools/retention_purge.py`, migration 0028, issue #16). It is dry-run by default, uses a 90-day cutoff by default, and has not been run against any database.

## Scope

Titan Central API (`apps/control-api`) and its PostgreSQL schema `titan` (migrations 0001 to 0007).
It covers three kinds of record: audit rows, login state and session revocations, and service logs.
Metrics are in-process counters and hold no personal data, so they have no retention period.

## 1. Audit rows (`titan.provisioning_audit`)

Each provisioning write records `request_id`, `actor_subject` (the Logto subject of the operator),
`authority_reference`, `command_kind`, `command_digest` (not the command body), `subject_id` and `created_at`.

- **CURRENT:** rows are append-only as far as the code is concerned. Nothing deletes them.
- **Proposed:** keep audit rows for a fixed period, then remove them by a scheduled job in bounded batches.
- **DECIDED (owner):** retention period of **1 year** for audit rows. The owner did not state the point from which
  the year is counted; that detail is still open. The period is decided; the purge itself is still Proposed (below).
- **TO DECIDE (legal):** whether `actor_subject` and `subject_id` are personal data for this purpose, and whether an
  erasure request can be honoured by pseudonymisation rather than deletion while the audit duty runs.
- **TO DECIDE (owner):** whether audit rows are exported to an external store before deletion.

Access decisions (allow and deny) are also written to `titan.activity_events` (section 6), one row each. They
are still in the service log (section 3). Their retention period is the same as for audit rows above: **1 year**
(owner decision, see section 6).

## 2. Login state and session revocations

**Login state (`titan.titan_oidc_login_states`).**

- **CURRENT:** a row expires no later than 10 minutes after creation. Consuming a row deletes it. A cleanup
  function deletes expired rows in bounded batches. Expired rows are treated as invalid even before cleanup.
- **Not decided:** the owner's 1-year decision does not cover login state. Its retention period is still undecided.
- **Proposed:** run that cleanup on a fixed schedule (for example every 15 minutes) so no expired row
  outlives a short grace period. Login state holds sealed nonce and verifier values, so it must not be kept
  longer than needed.

**Session revocations (`titan.titan_session_revocations`).**

- **CURRENT:** one row per (application, subject, organisation), holding a generation counter and `revoked_at`.
  Rows are not deleted.
- **Proposed:** a revocation row is needed for as long as a session that predates it could still be valid.
  Keep each row for at least the longest session or refresh-token lifetime configured in Logto, then remove it.
- **TO DECIDE (owner):** the longest session lifetime that applies, which fixes the minimum for this table.
- **Not decided:** the owner's 1-year decision does not cover session revocations. Their retention period is still undecided.

## 3. Service logs

- **CURRENT:** structured JSON logs go to stderr, which systemd captures in the journal (`journalctl -u titan-central`).
  The logger drops token, subject, email, code, state and secret-looking fields, and reduces errors to their class name.
- **Proposed:** keep journal data for a short fixed period (for example 30 days), then let journald rotate it out.
- **TO DECIDE (owner):** the journal period, and whether logs are shipped to a central store. A central store
  changes who can read the logs and needs its own decision. The owner's 1-year decision does not cover service
  logs; their retention period is still undecided.
- **TO DECIDE (legal):** whether IP addresses in reverse-proxy access logs (kept by Apache or nginx, outside this
  service) fall under the same period. This service does not log client IP addresses.

## 4. Metrics

- **CURRENT:** counters live in process memory on `GET /metrics`, bound to 127.0.0.1, and reset on restart.
  Labels are fixed (decision, denial reason code, rate-limit scope, Logto result). No tenant, subject,
  organisation or token value is recorded.
- **Required:** the reverse proxy must not forward `/metrics` to the public internet. The loopback bind does not
  stop a proxy on the same host from forwarding it.

## 5. Backups and erasure

- **TO DECIDE (owner):** backup retention for the `titan_central` database, and whether it follows section 1 or
  a shorter period.
- **TO DECIDE (legal):** how an erasure request for an operator or subject is handled across audit rows, backups
  and logs, and who approves it.

## 6. Activity history (`titan.activity_events`, migration 0011)

- **CURRENT:** rows are append-only. No role has UPDATE, DELETE or TRUNCATE, and a trigger rejects them for every role. Nothing in the code deletes rows.
- **CURRENT:** every access decision (allow and deny) from `GET /v1/access/check` is recorded here, with actor
  `central-access-check`, action `access.check`, the requested application and action, the reason code, and the
  role (allow only). The Logto subject, the token and raw error text are not stored. Requests that make no decision
  (401, 400, 429, 503) are not recorded.
- **CURRENT, recorder outage policy (fail open, fail visible):** a recording failure never changes the access
  response. The response waits at most 2 seconds for the recorder, then goes out. Each failure writes one
  `activity_record_failed` log line with the error class only. There is no retry and no queue, so a decision whose
  row was not written is missing from this table; the log line is the only trace. A timed-out insert may still
  commit, so such a decision can appear here and also in the log. Decisions for an organisation that is not in
  `titan.organisations` cannot be recorded (foreign key), and are logged as failures.
- **TO DECIDE (owner):** whether a missing row for a decision is acceptable, or whether access must wait for the
  recorder (fail closed). The current choice favours availability and keeps the response shape fixed.
- **CURRENT:** each row holds identifiers, an outcome and a detail object of at most 1,024 bytes, redacted before insert. Credentials and email addresses are refused, and personal-data keys are removed. Actor and target fields refuse address-shaped values.
- **Proposed:** a purge run by the owner, outside the application, that removes rows older than the retention period. It must be the only path that deletes rows, must be bounded in batches, and must be recorded. It is not written.
- **DECIDED (owner):** retention period of **1 year**, the same as section 1. The owner did not state the point
  from which the year is counted; that detail is still open.
- **TO DECIDE (owner):** whether activity export is needed (for example to a customer's own store) and in what format. The current reader returns one organisation's events, newest first, in pages of 100, and is the basis for any export.
- **TO DECIDE (owner):** which roles may read activity. Tenant users should see events their role permits. Support operators should see only what their role permits, and each read should be audited. No operator read path exists yet.

## 7. Purge job (issue #16)

- **CURRENT (implemented, not run):** `tools/retention_purge.py` deletes `titan.activity_events` and `titan.provisioning_audit`
  rows older than `--retention-days` (default **90**). It is a dry run unless `--execute` is passed. Each batch is one
  transaction, run as `titan_retention_purger`, bounded by the same cutoff in the database (migration 0028).
- **Conflict to resolve:** the 90-day default comes from the repository owner's instruction for issue #16. Section 1 and
  section 6 above record a DECIDED 1-year period. Until the owner confirms which applies, set `--retention-days 365` before any
  `--execute` run, or change the default in the tool.
- **Gap:** the migration 0028 carve-out has no PostgreSQL test yet. Review it, and apply the migration only after that review.
- Rollback for the migration: `database/retention/rollback_0028.sql`.

## Open items summary

| Item | Owner of decision |
| --- | --- |
| Retention period for login state, session revocations, service logs and backups (not covered by the 1-year decision) | Owner |
| Point from which the 1-year period is counted (audit rows and activity history) | Owner |
| Whether audit rows hold personal data; pseudonymisation | Legal |
| Whether access decisions need an audit table | Owner |
| Longest session lifetime (revocation retention floor) | Owner |
| Activity history export format and read roles | Owner |
| Journal retention period; central log store | Owner |
| Proxy access-log IP retention | Legal |
| Backup retention and erasure handling | Legal and owner |
