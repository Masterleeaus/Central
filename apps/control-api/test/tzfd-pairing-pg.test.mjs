/** Integration tests for the PostgreSQL pairing store against migration 0031.
 * Runs only when TITAN_TZFD_TEST_DATABASE_URL names a database with migration 0031 applied and the
 * titan_tzfd_pair role granted to the login role. Skipped otherwise. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import pg from 'pg';
import { createPostgresTzfdPairingStore } from '../src/tzfd-pairing-pg.mjs';
import { createTzfdPairingHandler, TZFD_PAIR_PATH, TZFD_PAIR_CONTRACT } from '../src/tzfd-pairing-handler.mjs';

const URL_ = process.env.TITAN_TZFD_TEST_DATABASE_URL;
const skip = URL_ ? false : 'TITAN_TZFD_TEST_DATABASE_URL not set';
const COMPANY = '6f1c2e0a-9b8d-4c3e-8f7a-1b2c3d4e5f60';
const OTHER_COMPANY = '11111111-2222-3333-4444-555555555555';
const FEATURE = 'https://superchargedat.work/api/tzfd/ai';
const hex = (n) => randomBytes(n).toString('hex');
const digest = (code) => createHash('sha256').update(code, 'utf8').digest('hex');
const siteId = () => `site-${hex(12)}`;

let admin;
let pool;

before(() => {
  if (skip) return;
  admin = new pg.Pool({ connectionString: URL_, max: 2 });
  pool = new pg.Pool({ connectionString: URL_, max: 2 });
});

after(async () => {
  await admin?.end();
  await pool?.end();
});

/** Inserts a code with a chosen expiry. Uses the superuser pool, outside the narrow role. */
async function seedCode({ company = COMPANY, expiresInMs = 3_600_000, createdAgoMs = 0 } = {}) {
  const code = `T${hex(10)}`;
  await admin.query(
    `INSERT INTO titan.tzfd_pairing_codes(code_digest,company_uuid,created_at,expires_at)
     VALUES($1,$2,now()-($3::int||' milliseconds')::interval,now()-($3::int||' milliseconds')::interval+($4::int||' milliseconds')::interval)`,
    [digest(code), company, createdAgoMs, expiresInMs],
  );
  return { code, codeDigest: digest(code) };
}

async function codeUsed(codeDigest) {
  const r = await admin.query('SELECT used_at IS NOT NULL AS used FROM titan.tzfd_pairing_codes WHERE code_digest=$1', [codeDigest]);
  return r.rows[0].used;
}

const nowMs = () => Date.now();

test('a valid code pairs the site and returns its company', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  const { codeDigest } = await seedCode();
  const site = siteId();
  const secret = hex(32);
  const out = await store.pair({ codeDigest, siteId: site, secret, nowMs: nowMs() });
  assert.deepEqual(out, { companyUuid: COMPANY });
  const row = await admin.query('SELECT company_uuid::text, secret FROM titan.tzfd_site_secrets WHERE site_id=$1', [site]);
  assert.equal(row.rows[0].company_uuid, COMPANY);
  assert.equal(row.rows[0].secret, secret);
  assert.equal(await codeUsed(codeDigest), true);
});

test('a used code is refused and changes nothing', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  const { codeDigest } = await seedCode();
  const site = siteId();
  assert.ok(await store.pair({ codeDigest, siteId: site, secret: hex(32), nowMs: nowMs() }));
  const again = await store.pair({ codeDigest, siteId: siteId(), secret: hex(32), nowMs: nowMs() });
  assert.equal(again, null);
  const count = await admin.query('SELECT count(*)::int AS n FROM titan.tzfd_site_secrets WHERE site_id=$1', [site]);
  assert.equal(count.rows[0].n, 1);
});

test('an expired code is refused and stays unused', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  const { codeDigest } = await seedCode({ createdAgoMs: 7_200_000, expiresInMs: 60_000 });
  assert.equal(await store.pair({ codeDigest, siteId: siteId(), secret: hex(32), nowMs: nowMs() }), null);
  assert.equal(await codeUsed(codeDigest), false);
});

test('a site bound to another company rejects the call and the code is NOT consumed', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  const site = siteId();
  await admin.query(
    'INSERT INTO titan.tzfd_site_secrets(site_id,company_uuid,secret,paired_at) VALUES($1,$2,$3,now())',
    [site, OTHER_COMPANY, hex(32)],
  );
  const { codeDigest } = await seedCode({ company: COMPANY });
  await assert.rejects(store.pair({ codeDigest, siteId: site, secret: hex(32), nowMs: nowMs() }));
  assert.equal(await codeUsed(codeDigest), false, 'the refused binding must roll back the code use');
});

test('a re-pairing by the same company rotates the secret', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  const site = siteId();
  const first = await seedCode();
  await store.pair({ codeDigest: first.codeDigest, siteId: site, secret: hex(32), nowMs: nowMs() });
  const second = await seedCode();
  const newSecret = hex(32);
  assert.deepEqual(await store.pair({ codeDigest: second.codeDigest, siteId: site, secret: newSecret, nowMs: nowMs() }), { companyUuid: COMPANY });
  const row = await admin.query('SELECT secret FROM titan.tzfd_site_secrets WHERE site_id=$1', [site]);
  assert.equal(row.rows[0].secret, newSecret);
});

test('the pairing role cannot read the tables directly', { skip }, async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE titan_tzfd_pair');
    await assert.rejects(client.query('SELECT count(*) FROM titan.tzfd_site_secrets'), /permission denied/);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('malformed inputs are refused without touching the database', { skip }, async () => {
  const store = createPostgresTzfdPairingStore({ pool });
  assert.equal(await store.pair({ codeDigest: 'nothex', siteId: siteId(), secret: hex(32), nowMs: nowMs() }), null);
  assert.equal(await store.pair({ codeDigest: digest('x'), siteId: 'site-bad', secret: hex(32), nowMs: nowMs() }), null);
  assert.equal(await store.pair({ codeDigest: digest('x'), siteId: siteId(), secret: 'short', nowMs: nowMs() }), null);
});

test('end to end over the HTTP handler with the Postgres store', { skip }, async () => {
  const handler = createTzfdPairingHandler({ store: createPostgresTzfdPairingStore({ pool }), featureEndpoint: FEATURE });
  const { code } = await seedCode();
  const site = siteId();
  const nonce = hex(16);
  const req = Readable.from([Buffer.from(JSON.stringify({ contract: TZFD_PAIR_CONTRACT, site, pairing_code: code }))]);
  Object.assign(req, {
    method: 'POST',
    url: TZFD_PAIR_PATH,
    headers: {
      'x-tzfd-contract': TZFD_PAIR_CONTRACT,
      'x-tzfd-site': site,
      'x-tzfd-nonce': nonce,
      'x-tzfd-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    socket: { remoteAddress: '198.51.100.9' },
  });
  let status;
  let body = '';
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  assert.equal(await handler(req, res), true);
  assert.equal(status, 200);
  const out = JSON.parse(body);
  assert.equal(out.status, 'paired');
  assert.match(out.secret, /^[a-f0-9]{64}$/);
  assert.equal(out.feature_endpoint, FEATURE);
  assert.equal(body.includes(code), false);
});
