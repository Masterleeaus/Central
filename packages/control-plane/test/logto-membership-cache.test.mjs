import test from 'node:test';
import assert from 'node:assert/strict';
import { LogtoManagementVerifier } from '../dist/logto-management.js';

const ok = value => ({ ok: true, json: async () => value });
const notFound = { ok: false, json: async () => ({}) };

/** Mutable fake Logto tenant that counts every management call. */
function tenant({ members = [], roles = {} } = {}) {
  const state = { members: new Set(members), roles, calls: 0 };
  const fetcher = async url => {
    state.calls++;
    const u = new URL(url);
    const p = u.pathname;
    if (/^\/api\/users\/[^/]+$/.test(p)) return ok({ id: decodeURIComponent(p.split('/')[3]) });
    if (/^\/api\/organizations\/[^/]+$/.test(p)) return ok({ id: decodeURIComponent(p.split('/')[3]) });
    if (/^\/api\/organizations\/[^/]+\/users$/.test(p)) {
      const page = Number(u.searchParams.get('page') ?? 1);
      const all = [...state.members];
      return ok(all.slice((page - 1) * 100, page * 100).map(id => ({ id })));
    }
    const roleMatch = p.match(/^\/api\/organizations\/[^/]+\/users\/([^/]+)\/roles$/);
    if (roleMatch) return ok((state.roles[decodeURIComponent(roleMatch[1])] ?? []).map(id => ({ id })));
    return notFound;
  };
  return { state, fetcher };
}

function verifier(t, clock, extra = {}) {
  return new LogtoManagementVerifier({
    origin: 'https://identity.example.test',
    accessToken: async () => 'trusted-service-credential',
    fetcher: t.fetcher,
    clock,
    ...extra,
  });
}

test('repeat check within TTL costs zero Logto calls', async () => {
  const t = tenant({ members: ['user_a'] });
  let now = 0;
  const v = verifier(t, () => now, { membershipCacheTtlMs: 30_000 });
  await v.assertMembership('user_a', 'org_a');
  const afterFirst = t.state.calls;
  assert.ok(afterFirst <= 3, `cold check used ${afterFirst} calls`);
  now = 29_999;
  await v.assertMembership('user_a', 'org_a');
  await v.assertMembership('user_a', 'org_a');
  assert.equal(t.state.calls, afterFirst);
});

test('cold check on a 2,400-member organisation is bounded by the page limit', async () => {
  const members = Array.from({ length: 2400 }, (_, i) => `user_${i}`);
  const t = tenant({ members });
  const v = verifier(t, () => 0);
  await v.assertMembership('user_2399', 'org_a'); // last member, last page
  // identity + organisation + 25 member pages at most
  assert.ok(t.state.calls <= 27, `used ${t.state.calls} calls`);
});

test('a removed member is not served from cache beyond the TTL', async () => {
  const t = tenant({ members: ['user_a'] });
  let now = 1_000;
  const v = verifier(t, () => now, { membershipCacheTtlMs: 30_000 });
  await v.assertMembership('user_a', 'org_a');
  t.state.members.delete('user_a');

  // Inside the TTL the cached positive result may still be served (documented bound).
  now = 1_000 + 29_999;
  const before = t.state.calls;
  await v.assertMembership('user_a', 'org_a');
  assert.equal(t.state.calls, before);

  // At expiry the removal must be observed.
  now = 1_000 + 30_000;
  await assert.rejects(v.assertMembership('user_a', 'org_a'), /not a current organisation member/);
});

test('denials are never cached, so a newly added member is seen immediately', async () => {
  const t = tenant({ members: [] });
  let now = 0;
  const v = verifier(t, () => now, { membershipCacheTtlMs: 30_000 });
  await assert.rejects(v.assertMembership('user_a', 'org_a'), /not a current/);
  t.state.members.add('user_a');
  now = 1;
  await assert.doesNotReject(v.assertMembership('user_a', 'org_a'));
});

test('TTL of zero disables caching', async () => {
  const t = tenant({ members: ['user_a'] });
  const v = verifier(t, () => 0, { membershipCacheTtlMs: 0 });
  await v.assertMembership('user_a', 'org_a');
  const first = t.state.calls;
  await v.assertMembership('user_a', 'org_a');
  assert.equal(t.state.calls, first * 2);
});

test('cache size is bounded and evicts the oldest entry', async () => {
  const t = tenant({ members: ['u1', 'u2', 'u3'] });
  const v = verifier(t, () => 0, { membershipCacheTtlMs: 60_000, membershipCacheMaxEntries: 2 });
  await v.assertMembership('u1', 'org_a');
  await v.assertMembership('u2', 'org_a');
  await v.assertMembership('u3', 'org_a'); // evicts u1
  assert.equal(v.membershipCache.size, 2);
  const before = t.state.calls;
  await v.assertMembership('u3', 'org_a');
  assert.equal(t.state.calls, before, 'u3 should still be cached');
  await v.assertMembership('u1', 'org_a');
  assert.ok(t.state.calls > before, 'u1 was evicted and must be re-verified');
});

test('role check reuses cached membership, leaving one roles call', async () => {
  const t = tenant({ members: ['user_a'], roles: { user_a: ['role_admin'] } });
  const v = verifier(t, () => 0, { membershipCacheTtlMs: 30_000 });
  await v.assertAnyOrganisationRole('user_a', 'org_a', ['role_admin']);
  const first = t.state.calls;
  await v.assertAnyOrganisationRole('user_a', 'org_a', ['role_admin']);
  assert.equal(t.state.calls - first, 1);
});

test('invalid cache configuration is rejected', () => {
  const base = { origin: 'https://identity.example.test', accessToken: async () => 'trusted-service-credential' };
  assert.throws(() => new LogtoManagementVerifier({ ...base, membershipCacheTtlMs: -1 }), /TTL/);
  assert.throws(() => new LogtoManagementVerifier({ ...base, membershipCacheTtlMs: 300_001 }), /TTL/);
  assert.throws(() => new LogtoManagementVerifier({ ...base, membershipCacheMaxEntries: 0 }), /size/);
});
