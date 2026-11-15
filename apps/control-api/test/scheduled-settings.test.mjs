import test from 'node:test';
import assert from 'node:assert/strict';
import { readScheduledSettings } from '../src/scheduled-settings.mjs';

const base = (over = {}) => ({
  TITAN_SCHEDULED_ORIGIN: 'https://scheduled.example.test',
  TITAN_SCHEDULED_AUDIENCE: 'aud-scheduled',
  TITAN_PRODUCT_TRUSTED_ORIGINS: 'https://scheduled.example.test,https://desk.example.test',
  TITAN_FIELD_AUDIENCE: 'aud-field', TITAN_DESK_AUDIENCE: 'aud-desk', TITAN_ACADEMY_AUDIENCE: 'aud-academy',
  ...over,
});

test('unset Scheduled settings mean not configured and nothing is checked', () => {
  assert.equal(readScheduledSettings({}), null);
  assert.equal(readScheduledSettings({ TITAN_SCHEDULED_ORIGIN: '', TITAN_SCHEDULED_AUDIENCE: '' }), null);
});

test('a complete configuration returns the normalised origin and audience', () => {
  assert.deepEqual(readScheduledSettings(base()), { origin: 'https://scheduled.example.test', audience: 'aud-scheduled' });
});

test('the origin must be HTTPS with no path, query, credentials or port', () => {
  for (const bad of ['http://scheduled.example.test', 'https://scheduled.example.test/app', 'https://scheduled.example.test/?x=1',
    'https://user@scheduled.example.test', 'https://scheduled.example.test:8443', 'REPLACE_ME', 'scheduled.example.test']) {
    assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_ORIGIN: bad })), /TITAN_SCHEDULED_ORIGIN must be an/, bad);
  }
});

test('the origin must also be on the trusted origin allowlist', () => {
  assert.throws(() => readScheduledSettings(base({ TITAN_PRODUCT_TRUSTED_ORIGINS: 'https://desk.example.test' })),
    /TITAN_SCHEDULED_ORIGIN must be listed in TITAN_PRODUCT_TRUSTED_ORIGINS/);
  assert.throws(() => readScheduledSettings(base({ TITAN_PRODUCT_TRUSTED_ORIGINS: undefined })),
    /TITAN_SCHEDULED_ORIGIN must be listed in TITAN_PRODUCT_TRUSTED_ORIGINS/);
});

test('the audience is required with the origin, and the origin is required with the audience', () => {
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: undefined })), /TITAN_SCHEDULED_AUDIENCE must be set/);
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_ORIGIN: undefined })), /TITAN_SCHEDULED_ORIGIN must be set/);
});

test('the audience must not be a placeholder, too long, padded, the link audience or another app audience', () => {
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: 'REPLACE_ME' })), /non-placeholder/);
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: 'a'.repeat(201) })), /at most 200/);
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: ' aud-scheduled' })), /non-placeholder/);
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: 'titan-central' })), /must not equal the link audience/);
  assert.throws(() => readScheduledSettings(base({ TITAN_SCHEDULED_AUDIENCE: 'aud-desk' })), /must differ from TITAN_DESK_AUDIENCE/);
});

test('error messages name variables and never echo a configured value', () => {
  const secretish = 'https://scheduled.example.test/leak-me';
  try { readScheduledSettings(base({ TITAN_SCHEDULED_ORIGIN: secretish })); assert.fail('expected rejection'); } catch (e) {
    assert.ok(!e.message.includes('leak-me'));
  }
});
