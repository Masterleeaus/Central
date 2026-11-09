# Subscription lifecycle and entitlements

Status: implemented as a provider-agnostic core in `packages/control-plane`. No real billing provider is connected,
no webhook HTTP route exists in `apps/control-api`, and the plan catalogue holds placeholders. Items marked
**TO DECIDE** are open product, finance or security decisions. The code does not invent answers to them.

## Boundaries

- Payment credentials, card data and bank details never enter this repository or its database. A provider adapter
  receives the provider's signed webhook body and turns it into a `ProviderEvent`: identifiers, a state, a plan id,
  add-on ids and dates. Nothing else is read or stored.
- The webhook signing secret is loaded by the caller from its own secret store. It is passed in per call and is never
  logged, stored or committed here.
- Entitlements change only through `CentralProvisioner` (`src/provisioning.ts`), with the revision the change was
  computed from. Nothing in this feature writes SQL to `titan.entitlements` directly.

## Modules (`packages/control-plane/src`)

| Module | Role |
| --- | --- |
| `subscription-model.ts` | States, the transition table, and the pure mapping from a snapshot to one entitlement change per application. |
| `plan-catalogue.ts` | Declared plans and add-ons, validated when the module loads. Resolves a plan and add-ons to features per application. |
| `webhook-verifier.ts` | HMAC-SHA256 over the raw body, a timestamp tolerance, and constant-time comparison. |
| `billing-adapter.ts` | The adapter interface a provider implements: `verify` and `parse`. |
| `subscription-lifecycle.ts` | The service: verify, dedupe, order, check the transition, map, mutate through the provisioning port, record. |
| `billing-ledger-pg.ts` | PostgreSQL ledger (migration 0015) and entitlement reader (through the organisation-scoped read snapshot). |
| `provisioning.ts` | `entitlement_update` now also accepts `features` and `expiresAt`, and revokes sessions on any reduction. |

## State model

States: `trial`, `active`, `grace` (payment failed), `cancelled`, `refunded`, `expired`.

A subscription may start in `trial` or `active`. Transitions allowed by `SUBSCRIPTION_TRANSITIONS`:

| From \ To | trial | active | grace | cancelled | refunded | expired |
| --- | --- | --- | --- | --- | --- | --- |
| (none) | yes | yes | no | no | no | no |
| trial | yes | yes | yes | yes | yes | yes |
| active | no | yes | yes | yes | yes | yes |
| grace | no | yes | yes | yes | yes | yes |
| cancelled | no | yes | no | yes | yes | yes |
| refunded | no | no | no | no | yes | no |
| expired | no | no | no | no | no | yes |

A self-transition (for example `active` to `active`) is a renewal or a date update. `refunded` and `expired` are terminal:
a later event cannot move a subscription back to an access state. A new paid period after expiry is a new subscription id.

## Mapping to entitlements

Each snapshot produces one change per application (`field`, `desk`, `academy`). Features are the union of the plan and
its add-ons for that application, sorted. An application the plan does not cover is always `revoked` with no features.

| Subscription state | Entitlement state | Features | expires_at |
| --- | --- | --- | --- |
| trial | `trialing` | granted | `trialEndsAt` (required) |
| active | `active` | granted | `periodEndsAt` (required; renewal moves it forward) |
| grace | `active` | granted | `graceEndsAt` (required). **TO DECIDE**: grace length and who sets it |
| cancelled, with `accessEndsAt` | `active` | granted | `accessEndsAt` |
| cancelled, no `accessEndsAt` | `revoked` | none | null. **TO DECIDE**: immediate or end-of-period cancellation |
| refunded | `revoked` | none | null. **TO DECIDE**: partial refunds and disputes/chargebacks (not modelled) |
| expired | `expired` | none | null |

A missing required date is a rejected event, not an open-ended grant. An unknown plan or add-on is rejected.

## Plan catalogue

Plans and add-ons share one id space. Each grants features per application. Validation at load:

- ids match `^[a-z][a-z0-9_]{0,63}$` and are unique across plans and add-ons;
- every product is a known application (`field`, `desk`, `academy`);
- every feature is one the application's registry declares (the actions in `applications.ts`), listed once;
- every plan and add-on grants at least one product, and there is at least one plan.

Errors list every problem at once. The entries in `plan-catalogue.ts` are placeholders named `example_*`.
**TO DECIDE**: real plans, add-ons, feature sets and the provider price-id mapping. Price ids map to catalogue ids in
the adapter, never the other way round.

## Webhook verification

Header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. One or more `v1` values are accepted (for secret rotation).

Order of checks: header present, header well formed, **signature** (constant time), then **timestamp**. Checking the
signature first means the timestamp check never acts on unsigned content. The tolerance is 300 seconds on either side.
A secret shorter than 32 characters is refused. Real providers have their own schemes; an adapter implements its own
`verify` and may call `verifyWebhookSignature`.

Rejected deliveries (`missing_signature`, `malformed_signature`, `bad_signature`, `stale_timestamp`, `future_timestamp`)
return before any parsing or storage. They are not recorded in the database. **TO DECIDE**: whether to log them
(and for how long, see `RETENTION.md`).

## Processing one verified event

1. Parse with the adapter. A parse failure is `invalid_payload` and is not stored.
2. Take the per-subscription lock (session advisory lock on one connection). Two deliveries for one subscription never interleave.
3. Record the event in `titan.billing_events` as `pending`, or find it already recorded.
   - Already recorded with a final disposition: `duplicate`. Nothing changes.
   - Still `pending` (an earlier attempt failed): processed again. Each write is idempotent (see below).
4. If the subscription is bound to another organisation: `rejected_organisation`.
5. Ordering. Position is `(occurredAt, providerEventId)`. An event older than the last applied position is
   `ignored_out_of_order`. The last applied event itself is re-run, which is how crash recovery works.
6. Transition check against the recorded state. A disallowed transition is `rejected_transition`.
7. Mapping. A mapping error is `rejected_invalid`.
8. For each application: read the entitlement row (with its revision). If it already matches the target, write nothing.
   Otherwise write through `CentralProvisioner` with `expectedRevision` set to the revision read. A concurrent change makes
   the write fail with a revision conflict, and nothing is written. A row that does not exist is created only for
   `trialing` or `active` with features. A trial is created and then updated once.
9. Advance the subscription position, then record `applied` with the request ids written.

If step 8 or 9 fails, the transaction rolls back, the event stays `pending`, and the caller returns a non-2xx response so
the provider redelivers. Request ids are derived from the provider event id, the application and the step. A replay of
a partly applied event finds the entitlements already at target and writes nothing.

Concurrency: the lock serialises one subscription inside this process and across processes that use the same database.
The revision check independently protects each entitlement row.

## Revocation

`CentralProvisioner.apply` bumps the session revocation generation for every member of the organisation, for the affected
application, in the same transaction as the row change and the audit record. This is the same table and upsert that
`revokeAll` uses in `apps/control-api`. A reduction is any of:

- the state leaves `active` or `trialing` (refund, expiry, cancellation without an access end, pause, revoke);
- a feature present before is absent now;
- the expiry moves earlier, or changes from open-ended to a date.

Adding features, keeping the same set, or extending the expiry does not revoke. If the bump fails, the row change and
the audit record roll back with it (tested with a fake database).

## Audit trail

- `titan.provisioning_audit`: one row per applied entitlement command. The request id is derived from the provider event.
- `titan.billing_events`: one row per verified event, with its disposition, a reason, and the request ids it wrote.
  There is one row per provider event id, so a duplicate delivery points at the row it already has. Ignored and rejected events are kept here. The raw provider payload is not stored.
- `titan.billing_subscriptions`: the last applied state and position for each provider subscription, and the owning organisation.

## Database changes

Migration `0015_billing_events.sql` adds the two tables above, with grants to `titan_trusted_writer` only. It is needed
because `provisioning_audit` records only applied commands and keys on request id, so it cannot store an ignored event.
Nothing else stores the last applied position per subscription, and without it the ordering rule cannot be enforced.
Migration numbers 0010 to 0014 are unused. The runner applies versions in ascending order and does not need them to be contiguous.

## Testing

`packages/control-plane/test`: `subscription-model.test.mjs` (transitions, mapping, catalogue), `subscription-webhook.test.mjs`
(signature failure, timestamp tolerance, malformed headers), `subscription-lifecycle.test.mjs` (replay, grace, cancellation,
refund, out-of-order and tie ordering, organisation mismatch, pending recovery, stale revision, feature removal revoking
sessions), `entitlement-reduction.test.mjs` (what counts as a reduction, atomic rollback, validation) and
`billing-ledger-pg.test.mjs` (the ledger statements, lock, and transaction role).

The lifecycle tests run the real `CentralProvisioner` and `PostgresEntitlementReader` against a fake database that routes
their SQL (`test/helpers/fake-control-db.mjs`). The fake provider and the in-memory ledger are test-only.

Against a real PostgreSQL 16, migrations 0001 to 0009 and 0015 apply cleanly, the repository's login-role and RLS SQL
suites pass on a fresh database, and the ledger's SQL statements run as `titan_trusted_writer` with the expected results.
The TypeScript ledger has not been run against a real database; it has only the fake-pool tests.

## TO DECIDE

1. Grace length, and whether the provider or this service sets `graceEndsAt`. Owner: product and finance.
2. Cancellation: access to the paid period end, or revoke at once. The code does the former when `accessEndsAt` is given.
3. Reactivation: `cancelled` to `active` is allowed (before access ends). Confirm.
4. Trial length, conversion, and whether a trial can be refunded.
5. Real plans, add-ons, feature sets and the price-id mapping.
6. More than one subscription in one organisation covering the same application. The model has one entitlement row per
   organisation and application, so the last applied subscription wins for that application. Decide whether this is allowed.
7. Ordering key. Current rule: provider `occurredAt`, then event id. Prefer a provider sequence number if one exists.
8. Expiry without a provider event. Access already ends at `expires_at` through the access check, but the row keeps its
   state until an event arrives. Decide whether a scheduled sweep should set `expired`.
9. Authority for webhook-driven writes. `TrustedProvisioningService` requires an operator actor whose authority was verified,
   which a webhook is not. The lifecycle takes a `ProvisioningPort`, and the composition that wraps it with an authority
   policy for billing actors is not built.
10. Retention of `billing_events`, and whether to store or log rejected deliveries (`RETENTION.md`).
11. Dead letters: a delivery that keeps failing stays `pending` and is retried by the provider. Decide the retry limit and
    alerting.
12. Partial refunds, disputes and chargebacks. Currently only a full refund (`refunded`) is modelled.
13. Webhook secret rotation policy (which secret is current, and how long the old one stays valid).
14. The HTTP route, the choice of provider, and its adapter. None exists yet.
