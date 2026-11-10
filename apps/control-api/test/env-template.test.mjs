import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const LOCATION_FILES = { 'central.env': 'deploy/env.example', 'outbox-worker.env': 'deploy/outbox-worker.env.example' };
// Non-secret values the template may carry in clear: the loopback port default and the public Logto
// Management API resource and scope (owner-provided, issue #73). They are identifiers, not secrets.
// Secret rows are never listed here.
const NON_SECRET_DEFAULTS = {
  TITAN_CENTRAL_PORT: ['3102'],
  TITAN_LOGTO_MANAGEMENT_RESOURCE: ['https://auth.titanzero.io/api'],
  TITAN_LOGTO_MANAGEMENT_SCOPE: ['all'],
};

const template = read('deploy/env.example');
const outboxTemplate = read('deploy/outbox-worker.env.example');

// Parse the variable table: lines of the form "# | TITAN_NAME | location | yes|no | owner |".
const rowPattern = /^#\s*\|\s*(TITAN_[A-Z0-9_]+)\s*\|\s*(central\.env|outbox-worker\.env)\s*\|\s*(yes|no)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
const table = new Map();
for (const match of template.matchAll(rowPattern)) {
  table.set(match[1], { location: match[2], secret: match[3] === 'yes', owner: match[4] });
}

// Every TITAN_* name that the control API source contains (env reads and the names they are given by constants).
const srcDir = new URL('apps/control-api/src/', root);
const codeNames = new Set();
for (const file of readdirSync(fileURLToPath(srcDir))) {
  if (!file.endsWith('.mjs')) continue;
  const text = readFileSync(new URL(file, srcDir), 'utf8');
  // The lookahead skips wildcard prefixes such as "TITAN_OPERATOR_*" in comments.
  for (const match of text.matchAll(/TITAN_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_])/g)) codeNames.add(match[0]);
}

test('the table has one row per variable and every row names a known location and owner', () => {
  assert.ok(table.size > 0, 'the variable table was not parsed');
  for (const [name, row] of table) {
    assert.ok(row.owner.length > 0, `${name} has no owner`);
    assert.ok(Object.hasOwn(LOCATION_FILES, row.location), `${name} has an unknown location`);
  }
});

test('every TITAN_* name read by apps/control-api/src is in the table', () => {
  const missing = [...codeNames].filter((name) => !table.has(name));
  assert.deepEqual(missing, [], `read by code but missing from the table in deploy/env.example`);
});

test('every table row is read by apps/control-api/src', () => {
  const unused = [...table.keys()].filter((name) => !codeNames.has(name));
  assert.deepEqual(unused, [], 'listed in the table but never read by apps/control-api/src');
});

test('every table row appears in the file it names, as a line or a commented line', () => {
  for (const [name, row] of table) {
    const text = row.location === 'central.env' ? template : outboxTemplate;
    const pattern = new RegExp(`^#?\\s*${name}=`, 'm');
    assert.match(text, pattern, `${name} is not in ${LOCATION_FILES[row.location]}`);
  }
});

test('every active (uncommented) central.env assignment is in the table', () => {
  const active = [...template.matchAll(/^(TITAN_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const unlisted = active.filter((name) => !table.has(name));
  assert.deepEqual(unlisted, []);
});

test('secret rows keep the REPLACE_ME placeholder and no secret value is written', () => {
  for (const [name, row] of table) {
    if (!row.secret || row.location !== 'central.env') continue;
    const active = template.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (active) assert.equal(active[1], 'REPLACE_ME', `${name} must be REPLACE_ME`);
  }
});

test('active central.env values are placeholders or the listed non-secret defaults', () => {
  for (const match of template.matchAll(/^(TITAN_[A-Z0-9_]+)=(.*)$/gm)) {
    const [, name, value] = match;
    const allowed = value === 'REPLACE_ME' || value === '' || (NON_SECRET_DEFAULTS[name] ?? []).includes(value);
    assert.ok(allowed, `${name} has a value that is not a placeholder`);
  }
});

test('outbox template keeps its secret placeholders', () => {
  for (const [name, row] of table) {
    if (!row.secret || row.location !== 'outbox-worker.env') continue;
    const active = outboxTemplate.match(new RegExp(`^${name}=(.*)$`, 'm'));
    assert.ok(active && active[1] === 'REPLACE_ME', `${name} must be REPLACE_ME in the outbox template`);
  }
});
