// Runs the pinned service-decision contract vectors (contracts/vectors/v1, issue #105) against the real handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVectorSet, runServiceCase, runServiceFile } from '../../../tools/contract-vectors/runner.mjs';

const { version, service } = loadVectorSet();

test(`service-decision vectors pin contract version ${version} and have unique case ids`, () => {
  assert.equal(service.contract, 'titan-central.service-decision');
  assert.equal(new Set(service.cases.map((c) => c.id)).size, service.cases.length);
});

test('every service-decision vector matches the handler', async () => {
  const counts = await runServiceFile(service);
  assert.ok(counts.accept >= 1 && counts.reject >= 1, JSON.stringify(counts));
});

for (const c of service.cases) {
  test(`vector ${c.id}`, () => runServiceCase(c, service));
}
