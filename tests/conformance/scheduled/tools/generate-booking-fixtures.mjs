// Test-only fixture generator for Scheduled's booking event publisher (conformance suite, Scheduled side S6).
//
// Usage: node tests/conformance/scheduled/tools/generate-booking-fixtures.mjs <path to a Scheduled checkout of integration/S6>
//
// Envelopes are produced by Scheduled's own code: BookingEventPublisher records the event, BookingEventEnvelope signs
// it, and SignedEventVerifier gives Scheduled's verdict. All of that runs through scheduled-booking-publisher.php. The
// secrets are deterministic test-only labels. They are not credentials and are not used outside this suite.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scheduledRoot = path.resolve(process.argv[2] ?? '');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', 'fixtures');
const appDir = path.join(scheduledRoot, 'core/app');
const driver = path.join(here, 'scheduled-booking-publisher.php');

const NOW_ISO = '2026-11-15T10:00:00.000Z';
const NOW_S = Math.floor(Date.parse(NOW_ISO) / 1000);
const EVENT_SECRET = 'titan-central conformance scheduled booking secret, test only, not a credential';
const OTHER_SECRET = 'titan-central conformance scheduled booking other secret, test only, not a credential';
const ORG = '6f1c2a3e-8b4d-4e5f-9a1b-2c3d4e5f6a7b';
const OTHER_ORG = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CONSUMER = 'scheduled-booking-inbox';

// Wire names from Scheduled's BookingEventType (CREATED, CANCELLED, RESCHEDULED).
const EVENT_TYPES = ['booking_created', 'booking_cancelled', 'booking_rescheduled'];

const booking = (overrides = {}) => ({
  bookingId: 'bk-0001',
  companyId: ORG,
  occurredAt: '2026-11-15T09:55:00.000Z',
  serviceId: 'svc-clean-01',
  staffIds: ['staff-02', 'staff-01'],
  startAt: '2026-11-20T09:00:00+11:00',
  endAt: '2026-11-20T11:00:00+11:00',
  timezone: 'Australia/Melbourne',
  status: 'confirmed',
  customerRef: 'cust-ref-0001',
  ...overrides,
});

const RESCHEDULED_TIMES = { startAt: '2026-11-21T14:00:00+11:00', endAt: '2026-11-21T16:00:00+11:00' };

// One PHP run builds every envelope, then one more run asks Scheduled's verifier for each verdict.
const runPhp = (requests) => {
  const run = spawnSync('php', ['-d', 'display_errors=stderr', driver, appDir], {
    input: JSON.stringify({ requests }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`php driver failed: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout);
};

const publish = (eventType, bookingInput, revision, eventTime, extra = {}) => ({
  op: 'publish',
  eventType,
  booking: bookingInput,
  revision,
  correlationId: null,
  eventId: extra.eventId ?? '3b7e9f10-2c4d-4e6f-8a9b-0c1d2e3f4a5b',
  occurredAt: eventTime,
  secret: extra.secret ?? EVENT_SECRET,
  ...(extra.tamper ? { tamper: extra.tamper } : {}),
});

const cases = [
  {
    id: 'B-01', name: 'booking_created-valid', eventType: 'booking_created', centralOutcome: 'processed',
    request: publish('booking_created', booking(), 1, '2026-11-15T09:55:00.000Z'),
  },
  {
    id: 'B-02', name: 'booking_cancelled-valid', eventType: 'booking_cancelled', centralOutcome: 'processed',
    request: publish('booking_cancelled', booking({ status: 'cancelled', occurredAt: '2026-11-15T09:56:00.000Z' }), 2,
      '2026-11-15T09:56:00.000Z', { eventId: '4c8f0a21-3d5e-4f70-9b0c-1d2e3f4a5b6c' }),
  },
  {
    id: 'B-03', name: 'booking_rescheduled-valid', eventType: 'booking_rescheduled', centralOutcome: 'processed',
    request: publish('booking_rescheduled', booking({ ...RESCHEDULED_TIMES, occurredAt: '2026-11-15T09:57:00.000Z' }), 3,
      '2026-11-15T09:57:00.000Z', { eventId: '5d9a1b32-4e6f-4a81-8c1d-2e3f4a5b6c7d' }),
  },
  {
    id: 'B-04', name: 'booking_created-tenant-mismatch', eventType: 'booking_created', centralOutcome: 'tenant_mismatch',
    note: 'Correctly signed for another tenant. Central binds the consumer to ORG and rejects it. Scheduled has no tenant check.',
    request: publish('booking_created', booking({ companyId: OTHER_ORG }), 1, '2026-11-15T09:55:00.000Z'),
  },
  {
    id: 'B-05', name: 'booking_created-organisation-rewritten', eventType: 'booking_created', centralOutcome: 'bad_signature',
    note: 'Signed for ORG, then organisationId rewritten to another tenant. The signature covers organisationId, so it fails first.',
    request: publish('booking_created', booking(), 1, '2026-11-15T09:55:00.000Z', { tamper: { organisationId: OTHER_ORG } }),
  },
  {
    id: 'B-06', name: 'booking_created-payload-tampered', eventType: 'booking_created', centralOutcome: 'bad_signature',
    request: publish('booking_created', booking(), 1, '2026-11-15T09:55:00.000Z', {
      tamper: { payload: { ...booking(), status: 'cancelled' } },
    }),
  },
  {
    id: 'B-07', name: 'booking_created-wrong-secret', eventType: 'booking_created', centralOutcome: 'bad_signature',
    request: publish('booking_created', booking(), 1, '2026-11-15T09:55:00.000Z', { secret: OTHER_SECRET }),
  },
  {
    id: 'B-08', name: 'booking_created-stale', eventType: 'booking_created', centralOutcome: 'stale',
    note: 'Both Scheduled and Central reject envelopes older than 86400 seconds before business effects.',
    request: publish('booking_created', booking(), 1, '2026-11-13T10:00:00.000Z'),
  },
  {
    id: 'B-09', name: 'booking_rescheduled-from-future', eventType: 'booking_rescheduled', centralOutcome: 'from_future',
    note: 'Both Scheduled and Central allow 300 seconds of future skew; this case is 20 minutes ahead.',
    request: publish('booking_rescheduled', booking({ ...RESCHEDULED_TIMES }), 3, '2026-11-15T10:20:00.000Z'),
  },
];

const built = runPhp(cases.map((c) => c.request));

// Unsigned variant: the valid booking_created body with its signature removed. Central refuses it at parse time.
const validCreated = built[0].body;
const unsignedBody = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(validCreated)).filter(([k]) => k !== 'signature')));

const verdictRequests = [
  ...built.map((b) => ({ op: 'verdict', body: b.body, secret: EVENT_SECRET, now: NOW_S })),
];
const verdictsFor = runPhp(verdictRequests);
const unsignedVerdict = runPhp([{ op: 'verdict', body: unsignedBody, secret: EVENT_SECRET, now: NOW_S }])[0];

const fixtureCases = cases.map((c, i) => {
  const verdict = verdictsFor[i];
  return {
    id: c.id,
    name: c.name,
    eventType: c.eventType,
    idempotencyKey: built[i].idempotencyKey,
    body: JSON.parse(built[i].body),
    scheduledVerdict: verdict.accepted ? { accepted: true } : { accepted: false, reason: verdict.reason },
    centralOutcome: c.centralOutcome,
    ...(c.note ? { note: c.note } : {}),
  };
});

fixtureCases.push({
  id: 'B-10',
  name: 'booking_created-unsigned',
  eventType: 'booking_created',
  idempotencyKey: built[0].idempotencyKey,
  body: JSON.parse(unsignedBody),
  scheduledVerdict: unsignedVerdict.accepted ? { accepted: true } : { accepted: false, reason: unsignedVerdict.reason },
  centralOutcome: 'invalid_envelope',
  note: 'Same envelope as B-01 with the signature removed.',
});

const fixture = {
  source: 'integration/S6: core/app/Booking/Events (BookingEventPublisher, BookingEventFacts, BookingEventEnvelope, '
    + 'BookingEventType) and core/app/Central/Events/SignedEventVerifier.php, run via tools/scheduled-booking-publisher.php',
  generatedBy: 'tests/conformance/scheduled/tools/generate-booking-fixtures.mjs',
  now: NOW_ISO,
  consumer: { consumer: CONSUMER, organisationId: ORG, eventTypes: EVENT_TYPES, secret: EVENT_SECRET },
  cases: fixtureCases,
};

writeFileSync(path.join(fixturesDir, 'booking-envelopes.json'), `${JSON.stringify(fixture, null, 2)}\n`);
process.stdout.write(`wrote ${fixtureCases.length} booking cases\n`);
