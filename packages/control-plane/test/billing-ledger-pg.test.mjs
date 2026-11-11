import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresBillingLedger } from '../dist/billing-ledger-pg.js';

// Records every statement. Returns configured rows for the statements that read or count.
function recordingPool(reply = () => ({ rows: [], rowCount: 0 })) {
  const log = []; let released = 0;
  const conn = { async query(text, params) { log.push({ text, params }); return reply(text, params); }, release() { released++; } };
  return { log, get released() { return released; }, pool: { async connect() { return conn; } } };
}
const KEY = { provider: 'fake-billing', providerEventId: 'evt_1', subscriptionId: 'sub_1', occurredAt: '2026-11-01T00:00:00.000Z' };

test('the subscription lock is a session advisory lock held on one connection and released after the task', async () => {
  const r = recordingPool();
  const out = await new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async () => 'done');
  assert.equal(out, 'done');
  assert.match(r.log[0].text, /pg_advisory_lock\(hashtextextended\(\$1,0\)\)/);
  assert.equal(r.log[0].params[0], 'billing:fake-billing:sub_1');
  assert.match(r.log.at(-1).text, /pg_advisory_unlock/);
  assert.equal(r.released, 1);
});

test('the lock is released even when the task fails', async () => {
  const r = recordingPool();
  await assert.rejects(new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async () => { throw Error('boom'); }), /boom/);
  assert.match(r.log.at(-1).text, /pg_advisory_unlock/);
  assert.equal(r.released, 1);
});

test('every ledger write runs in a transaction as titan_trusted_writer', async () => {
  const r = recordingPool((text) => (text.startsWith('INSERT INTO titan.billing_events') ? { rows: [{ disposition: 'pending' }], rowCount: 1 } : { rows: [], rowCount: 1 }));
  await new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async (tx) => {
    assert.deepEqual(await tx.beginEvent(KEY), { kind: 'new' });
  });
  const texts = r.log.map(l => l.text);
  const begin = texts.indexOf('BEGIN');
  assert.ok(begin > 0);
  assert.equal(texts[begin + 1], 'SET LOCAL ROLE titan_trusted_writer');
  assert.match(texts[begin + 2], /statement_timeout/);
  assert.equal(texts[texts.indexOf('COMMIT')], 'COMMIT');
  assert.match(r.log[begin + 3].text, /INSERT INTO titan\.billing_events .* ON CONFLICT \(provider, provider_event_id\) DO NOTHING/);
});

test('a duplicate event reports its stored disposition', async () => {
  const r = recordingPool((text) => (text.startsWith('INSERT INTO titan.billing_events') ? { rows: [], rowCount: 0 } : { rows: [{ disposition: 'applied' }], rowCount: 1 }));
  await new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async (tx) => {
    assert.deepEqual(await tx.beginEvent(KEY), { kind: 'existing', disposition: 'applied' });
  });
});

test('advancing the position is a conditional upsert that refuses to move backwards', async () => {
  const r = recordingPool((text) => (text.includes('ON CONFLICT (provider, subscription_id)') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));
  await assert.rejects(new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async (tx) => {
    await tx.advance('fake-billing', 'sub_1', { organisationId: '33333333-3333-4333-8333-333333333333', state: 'active', positionAt: KEY.occurredAt, positionEventId: 'evt_1' });
  }), /regressed/);
  const upsert = r.log.find(l => l.text.includes('ON CONFLICT (provider, subscription_id)'));
  assert.match(upsert.text, /WHERE \(titan\.billing_subscriptions\.position_at, titan\.billing_subscriptions\.position_event_id\) <= \(EXCLUDED\.position_at, EXCLUDED\.position_event_id\)/);
  assert.ok(r.log.some(l => l.text === 'ROLLBACK'), 'the failed advance rolls back');
  assert.equal(r.log.some(l => l.text === 'COMMIT'), false);
});

test('finishing an event records the disposition, reason and request ids, and requires the row to exist', async () => {
  const r = recordingPool((text) => (text.startsWith('UPDATE titan.billing_events') ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 1 }));
  await new PostgresBillingLedger(r.pool).withSubscriptionLock('fake-billing', 'sub_1', async (tx) => {
    await tx.finish('fake-billing', 'evt_1', 'applied', { reason: '', requestIds: ['11111111-1111-4111-8111-111111111111'] });
  });
  const upd = r.log.find(l => l.text.startsWith('UPDATE titan.billing_events'));
  assert.deepEqual(upd.params, ['fake-billing', 'evt_1', 'applied', null, ['11111111-1111-4111-8111-111111111111']]);
  const missing = recordingPool((text) => (text.startsWith('UPDATE titan.billing_events') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }));
  await assert.rejects(new PostgresBillingLedger(missing.pool).withSubscriptionLock('fake-billing', 'sub_1', async (tx) => {
    await tx.finish('fake-billing', 'evt_9', 'applied', { reason: '', requestIds: [] });
  }), /missing when finishing/);
});
