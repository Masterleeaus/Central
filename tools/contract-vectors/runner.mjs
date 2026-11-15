/**
 * Evaluates the versioned contract vectors in contracts/vectors/v1 against the live Central implementation.
 * Shared by the generator (checks every expectation before it writes a file) and by the CI test runners.
 * Each runner throws on the first mismatch. Nothing here reads a secret or a real key.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { LinkAssertionVerifier, LinkAssertionRejected } from '../../packages/control-plane/dist/link-assertion.js';
import { createSkilledDecisionHandler } from '../../apps/control-api/src/service-decision-handler.mjs';

export const VECTOR_DIR = new URL('../../contracts/vectors/v1/', import.meta.url);

const readVectorText = (name) => readFileSync(new URL(name, VECTOR_DIR), 'utf8');

/** Loads VERSION, link-assertion.json and service-decision.json, and checks they agree on the contract version. */
export function loadVectorSet() {
  const version = readVectorText('VERSION').trim();
  const link = JSON.parse(readVectorText('link-assertion.json'));
  const service = JSON.parse(readVectorText('service-decision.json'));
  assert.equal(link.contract_version, version, 'link-assertion.json contract_version must match VERSION');
  assert.equal(service.contract_version, version, 'service-decision.json contract_version must match VERSION');
  return { version, link, service };
}

function assertUniqueIds(cases, label) {
  const ids = cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate case id`);
}

/** Runs one link-assertion case in order against a fresh verifier and nonce store. */
export async function runLinkCase(c, file) {
  const consumed = new Set();
  const nonces = {
    async consume(productId, nonce) {
      const key = `${productId}|${nonce}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  };
  const verifier = new LinkAssertionVerifier(c.key_sets ?? file.key_sets, nonces, () => c.now ?? file.now);
  let last;
  for (const [index, step] of c.steps.entries()) {
    const where = `${c.id} step ${index + 1}`;
    const expectation = { ...file.default_expectation, ...(c.expectation ?? {}), ...(step.expectation ?? {}) };
    let outcome;
    try {
      outcome = { accept: true, result: await verifier.verify(step.token, expectation) };
    } catch (error) {
      if (!(error instanceof LinkAssertionRejected)) throw error;
      outcome = { accept: false, code: error.code };
    }
    if (step.expect === 'accept') {
      assert.equal(outcome.accept, true, `${where}: expected accept, got ${outcome.code}`);
      assert.deepEqual(outcome.result, step.result, `${where}: accepted result`);
    } else {
      assert.equal(outcome.accept, false, `${where}: expected reject ${step.code}`);
      assert.equal(outcome.code, step.code, `${where}: rejection code`);
    }
    last = step.expect;
  }
  assert.equal(last, c.expect, `${c.id}: case expect must equal the final step outcome`);
}

export async function runLinkFile(file) {
  assertUniqueIds(file.cases, 'link-assertion');
  for (const c of file.cases) await runLinkCase(c, file);
  return {
    accept: file.cases.filter((c) => c.expect === 'accept').length,
    reject: file.cases.filter((c) => c.expect === 'reject').length,
  };
}

/** Runs one service-decision case against the real handler on loopback, with the case's decision stub. */
export async function runServiceCase(c, file) {
  const { config } = file;
  let decideCalls = 0;
  const decide = async () => {
    decideCalls += 1;
    if (c.decision.mode === 'unavailable') throw new Error('backend unavailable');
    return c.decision.mode === 'deny' ? null : structuredClone(c.decision.value);
  };
  const handler = createSkilledDecisionHandler({
    issuer: config.issuer, audience: config.audience, token: config.bearer, decide, clock: () => Date.parse(file.now),
  });
  const server = createServer(async (req, res) => {
    if (!(await handler(req, res))) { res.statusCode = 404; res.end('not found'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const substitute = (value) => value.replaceAll('{{bearer}}', config.bearer).replaceAll('{{wrong_bearer}}', config.wrong_bearer);
    const headers = Object.fromEntries(Object.entries(c.request.headers).map(([k, v]) => [k, substitute(v)]));
    const body = Object.hasOwn(c.request, 'body_raw') ? c.request.body_raw
      : c.request.body === undefined ? undefined : JSON.stringify(c.request.body);
    const response = await fetch(`http://127.0.0.1:${server.address().port}${c.request.path}`, { method: c.request.method, headers, body });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    assert.equal(response.status, c.expect.status, `${c.id}: status`);
    if (c.expect.body !== undefined) assert.deepEqual(parsed, c.expect.body, `${c.id}: body`);
    assert.equal(decideCalls, c.expect.decide_called ? 1 : 0, `${c.id}: decision calls`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

export async function runServiceFile(file) {
  assertUniqueIds(file.cases, 'service-decision');
  for (const c of file.cases) await runServiceCase(c, file);
  return {
    accept: file.cases.filter((c) => c.expect.status === 200).length,
    reject: file.cases.filter((c) => c.expect.status !== 200).length,
  };
}
