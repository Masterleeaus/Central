import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvent, PRODUCTION_EVENT_REGISTRY, SCHEDULED_BOOKING_REQUIRED_FIELDS, OUTBOX_MAX_PAYLOAD_BYTES } from '../dist/outbox.js';

const ORG = '00000000-0000-4000-8000-00000000000a';
const SCHEDULED_TYPES = ['booking_created', 'booking_cancelled', 'booking_rescheduled'];

const payload = (over = {}) => ({
  bookingId: 'bk_01',
  companyId: 'co_01',
  occurredAt: '2026-11-15T01:00:00.000Z',
  serviceId: 'svc_clean_std',
  staffIds: ['st_01', 'st_02'],
  startAt: '2026-11-20T09:00:00.000Z',
  endAt: '2026-11-20T11:00:00.000Z',
  timezone: 'Australia/Melbourne',
  status: 'confirmed',
  customerRef: 'cust_opaque_7f3a',
  ...over,
});

const input = (over = {}) => ({
  organisationId: ORG, sourceProduct: 'scheduled', eventType: 'booking_created', schemaVersion: 1,
  correlationId: 'corr-1', idempotencyKey: 'scheduled:bk_01:created', payload: payload(), ...over,
});

test('the production registry accepts all three Scheduled booking events at version 1', () => {
  for (const eventType of SCHEDULED_TYPES) {
    const prepared = prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ eventType }));
    assert.equal(prepared.eventType, eventType);
    assert.equal(prepared.schemaVersion, 1);
    assert.equal(prepared.sourceProduct, 'scheduled');
  }
});

test('each Scheduled event definition lists scheduled as its only source', () => {
  for (const eventType of SCHEDULED_TYPES) {
    const def = PRODUCTION_EVENT_REGISTRY.find((d) => d.eventType === eventType && d.schemaVersion === 1);
    assert.ok(def, `${eventType}.v1 is registered`);
    assert.deepEqual([...def.sourceProducts], ['scheduled']);
    assert.deepEqual([...def.requiredPayloadFields], SCHEDULED_BOOKING_REQUIRED_FIELDS);
  }
});

test('a Scheduled event from another product is refused', () => {
  assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ sourceProduct: 'sorted' })), { code: 'source_not_allowed' });
});

test('a booking event without a required payload field is refused', () => {
  for (const field of SCHEDULED_BOOKING_REQUIRED_FIELDS) {
    const partial = payload();
    delete partial[field];
    assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ payload: partial })), { code: 'invalid_payload' }, field);
    assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ payload: payload({ [field]: null }) })), { code: 'invalid_payload' }, field);
  }
});

test('the optional customer reference may be absent', () => {
  const p = payload();
  delete p.customerRef;
  assert.equal(prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ payload: p })).eventType, 'booking_created');
});

test('unknown types and versions are still rejected', () => {
  for (const eventType of ['booking.created', 'booking.cancelled', 'booking_moved', 'booking', 'invoice_paid', 'Booking_Created']) {
    assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ eventType })), { code: 'unknown_event_type' }, eventType);
  }
  assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ schemaVersion: 2 })), { code: 'unknown_event_type' });
});

test('the booking payload stays small for a realistic multi-staff booking', () => {
  const staffIds = Array.from({ length: 20 }, (_, i) => `st_${String(i).padStart(3, '0')}`);
  const prepared = prepareEvent(PRODUCTION_EVENT_REGISTRY, input({ payload: payload({ staffIds }) }));
  assert.ok(Buffer.byteLength(prepared.payloadCanonical, 'utf8') < OUTBOX_MAX_PAYLOAD_BYTES / 4);
});

test('the booking payload schema carries no customer personal data fields', () => {
  const forbidden = /name|email|phone|address|mobile|dob|birth|note|notes|card|payment|location/i;
  for (const field of SCHEDULED_BOOKING_REQUIRED_FIELDS) {
    assert.doesNotMatch(field, forbidden, field);
  }
});
