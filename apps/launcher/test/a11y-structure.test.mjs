// Structural accessibility checks on the server-rendered HTML. These are not a WCAG conformance audit;
// they cover the properties the code can assert without a browser (see smoke.playwright.test.mjs for rendered checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW, DENY, SESSION, fakeCentral, startLauncher, testConfig } from './helpers.mjs';

async function renderStates(states) {
  const central = fakeCentral({ field: states[0], desk: states[1], academy: states[2] });
  const launcher = await startLauncher({ config: testConfig(), resolveSession: async () => SESSION, fetchImpl: central.fetchImpl });
  try {
    const res = await fetch(`${launcher.origin}/`);
    return await res.text();
  } finally { await launcher.close(); }
}

const signedOutHtml = async () => {
  const launcher = await startLauncher({ config: testConfig(), resolveSession: async () => null });
  try { return await (await fetch(`${launcher.origin}/`)).text(); } finally { await launcher.close(); }
};

const headingLevels = (html) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

function assertStructure(html) {
  assert.match(html, /^<!doctype html>\n<html lang="en">/, 'document language is declared');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, 'exactly one h1');
  const levels = headingLevels(html);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(levels[i] <= levels[i - 1] + 1, `heading level ${levels[i]} follows ${levels[i - 1]} without skipping`);
  }
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, target] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(ids.has(target), `aria-labelledby target ${target} exists`);
  assert.ok(ids.has('main') || html.includes('<main id="main"'), 'skip link target exists');
  assert.ok(html.includes('href="#main"'), 'skip link present');
  for (const [, body] of html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)) assert.ok(body.trim().length > 0, 'every link has visible text');
  assert.ok(!/tabindex="[1-9]/.test(html), 'no positive tabindex');
  assert.ok(!/\son[a-z]+="/i.test(html), 'no inline event handlers');
  assert.ok(!/<div[^>]*role="button"/.test(html), 'no div-based buttons');
  assert.ok(!/<img(?![^>]*\salt=)/.test(html), 'images have alt text');
  assert.ok(!/<input/.test(html) || /<label/.test(html), 'form controls have labels');
}

test('signed-out page meets the structural checks', async () => {
  assertStructure(await signedOutHtml());
});

test('launcher page with mixed product states meets the structural checks', async () => {
  assertStructure(await renderStates([ALLOW, DENY, [503, {}]]));
});

test('launcher page with all products available meets the structural checks', async () => {
  assertStructure(await renderStates([ALLOW, ALLOW, ALLOW]));
});

test('every product state is conveyed in text, not colour alone', async () => {
  const html = await renderStates([ALLOW, DENY, [503, {}]]);
  assert.ok(html.includes('Access granted.'));
  assert.ok(html.includes('Access denied for this company.'));
  assert.ok(html.includes('Status unavailable. Try again later.'));
});

test('product sections are labelled by their headings', async () => {
  const html = await renderStates([ALLOW, ALLOW, ALLOW]);
  assert.ok(html.includes('<section aria-labelledby="products-heading">'));
  assert.ok(html.includes('<h2 id="products-heading">Products</h2>'));
  assert.ok(html.includes('<section aria-labelledby="company-heading">'));
});
