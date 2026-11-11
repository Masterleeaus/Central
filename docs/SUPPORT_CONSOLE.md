# Support console read API (issue #39)

Status: read-only API and tests. Not mounted by the default server, not a UI. Product health and provisioning
progress are not available in this round and are reported as unavailable.

## Routes

| Method and path | Who | Result |
| --- | --- | --- |
| `GET /v1/support/organisations?logto_organisation_id=` | support role | Exact lookup. Returns the Central organisation id only. |
| `POST /v1/support/grants` `{organisationId, reason}` | support role | Issues a grant for one organisation. `reason` is one of `setup_diagnosis`, `integration_health`, `provisioning_check`. |
| `GET /v1/support/organisations/{id}` | support role and a grant for `{id}` | Overview: organisation, membership counts, entitlements per product, link state counts, recent activity (20), and source freshness. |

Any other method returns 405. Any other path under `/v1/support/` returns 404. No route writes except the audit
record of the call itself. Admin routes are unchanged and do not accept a support grant.

## Authority

The support role is checked by the existing Logto operator authoriser (`createLogtoOperatorAuthoriser` in
`apps/control-api/src/admin.mjs`), configured with a separate list of support role IDs. Role IDs come from operator
configuration, not from code. Authority is checked on every request. Removing the role takes effect on the next read,
even while a grant is still valid. An unreachable authoriser returns 503 and no data.

Note: the Logto verifier caches a positive membership result for its configured TTL, so the authority decision can
lag a role change by up to that TTL.

## Grants: signed, short-lived, one organisation

Choice: a server-signed value (HMAC-SHA256), not a stored grant. This needs no migration.

- Payload: subject, organisation id, scope `support:read`, issued-at, expiry, and a random id. No personal data.
- Lifetime: 600 seconds by default, at most 900 seconds. A grant is refused at its expiry second.
- Clock skew: a grant is accepted up to 60 seconds before its issued-at time.
- Bound to the subject that requested it and to one organisation. A grant for another organisation or another subject
  is refused.
- Refusal reasons are logged and written to the audit trail as `denied`: `grant_missing`, `grant_malformed`,
  `grant_bad_signature`, `grant_expired`, `grant_not_yet_valid`, `grant_subject_mismatch`,
  `grant_organisation_mismatch`.
- Trade-off: a grant cannot be revoked before it expires. Its lifetime is the bound. Role removal is still caught on
  every read.
- The signing key must be at least 32 bytes and is supplied by the operator. It is never logged or returned.

## Audit

Every call that reaches a support route is recorded in `titan.activity_events` (migration 0011), against the
organisation it concerns, with no data values in the detail:

- `support.organisation.lookup`, `support.organisation.view`, `support.grant.issue`: outcome `success`, written
  before the data is read or the grant is returned. If the record cannot be written, the request fails with 503.
- Denials: outcome `denied`, with the reason code. Written only when the organisation exists. This is best effort and
  does not change the response.

Limit: a lookup that matches no organisation cannot be recorded, because the events table requires an organisation.
Those attempts are written to the structured log only (`support_lookup_unmatched`, no values).

## Live data and unavailable data

- `sources.central`: live, read from Central's database on the request, in one snapshot.
- `sources.activity`: live.
- `products[].health`: live only when a product status provider is supplied and answers in time. Otherwise
  `unavailable` with reason `not_integrated`, `product_unreachable`, `timeout` or `invalid_response`. Product responses
  are reduced to a status and a checked-at time. No other product field is kept.
- `products[].provisioning` and `sources.productProvisioning`: always `unavailable` (`not_integrated`) in this round.
- `degraded`: true whenever any product section is not live. Central data is still returned in full.
- There is no cache of Central or product status in this round, so no field is labelled cached.

Product outages never block the grant, authority or audit checks, which run before the product calls.

## Tenant scope

Organisation reads run as `titan_trusted_reader` with `titan.organisation_id` set for the transaction, so the
row-level policies in migrations 0006, 0008 and 0011 apply. Each row is also checked against the requested
organisation in application code, and a foreign row fails the read. Lookups return at most one exact match.
Verified against PostgreSQL 16 (see the issue #39 report).

## Not in this round

- Mounting in the server (`startCentralService`) and the environment variables for the support role IDs and the grant
  key. The handler is injected, as the admin handler is.
- Rate limiting for `/v1/support/` (the admin path has none either).
- A product status provider and provisioning progress from the products (depends on #29 and the product APIs).
- Any write path beyond audit records, and any exceptional-action permission (the issue asks for a separate
  permission and confirmation; none is designed here).
