import { createServer } from 'node:http';
import { loadConfig } from '../src/config.mjs';
import { createLauncherServer } from '../src/server.mjs';

export const CENTRAL = 'https://central.test';
export const SESSION = Object.freeze({ organisationId: '11111111-2222-4333-8444-555555555555', accessToken: 'token-abc123', companyName: 'Acme Cleaning' });

/** A valid config with the central origin replaced for the test. Product URLs are example hosts. */
export function testConfig(overrides = {}) {
  return loadConfig({
    centralOrigin: CENTRAL,
    signIn: { applicationId: 'desk' },
    organisationSwitch: null,
    timeoutMs: 2000,
    products: [
      { id: 'sorted', legacyApplication: 'field', displayName: 'Sorted', url: 'https://sorted.example.test' },
      { id: 'supercharged', legacyApplication: 'desk', displayName: 'Supercharged', url: 'https://supercharged.example.test' },
      { id: 'lms', legacyApplication: 'academy', displayName: 'LMS', url: 'https://lms.example.test' },
    ],
    ...overrides,
  });
}

/** Fake Central: decides per application from a map of { application: [status, body] } or a thrown error. */
export function fakeCentral(decisions) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const decision = decisions[u.searchParams.get('application')];
    if (decision instanceof Error) throw decision;
    const [status, body] = decision ?? [403, { allowed: false, role: null, reason: 'not_entitled' }];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

export const ALLOW = [200, { allowed: true, role: 'member', reason: 'allowed' }];
export const DENY = [403, { allowed: false, role: null, reason: 'not_entitled' }];

/** Starts the launcher on an ephemeral localhost port. Returns { origin, close }. */
export async function startLauncher(options) {
  const server = createLauncherServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Starts a plain http server standing in for Central on an ephemeral port. */
export async function startMockCentral(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
