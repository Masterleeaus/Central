// Runs the pinned link-assertion contract vectors (contracts/vectors/v1, issue #105) against LinkAssertionVerifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVectorSet, runLinkCase, runLinkFile } from '../../../tools/contract-vectors/runner.mjs';

const { version, link } = loadVectorSet();

test(`link-assertion vectors pin contract version ${version} and have unique case ids`, () => {
  assert.equal(link.contract, 'titan-central.link-assertion');
  assert.equal(new Set(link.cases.map((c) => c.id)).size, link.cases.length);
});

test('every link-assertion vector matches the verifier', async () => {
  const counts = await runLinkFile(link);
  assert.ok(counts.accept >= 1 && counts.reject >= 1, JSON.stringify(counts));
});

for (const c of link.cases) {
  test(`vector ${c.id}`, () => runLinkCase(c, link));
}
