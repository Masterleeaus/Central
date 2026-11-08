import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installShutdown } from '../src/server.mjs';

const quietLog = { log() {}, error() {} };

function harness(closeImpl) {
  const proc = new EventEmitter();
  const exits = [];
  let closes = 0;
  const service = { close: () => { closes += 1; return closeImpl(); } };
  installShutdown(service, { proc, exit: (code) => exits.push(code), timeoutMs: 1000, log: quietLog });
  return { proc, exits, closes: () => closes };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('SIGTERM closes the service and exits 0', async () => {
  const h = harness(async () => {});
  h.proc.emit('SIGTERM');
  await flush();
  assert.equal(h.closes(), 1);
  assert.deepEqual(h.exits, [0]);
});

test('SIGINT closes the service and exits 0', async () => {
  const h = harness(async () => {});
  h.proc.emit('SIGINT');
  await flush();
  assert.equal(h.closes(), 1);
  assert.deepEqual(h.exits, [0]);
});

test('a close failure exits 1', async () => {
  const h = harness(async () => { throw new Error('pool busy'); });
  h.proc.emit('SIGTERM');
  await flush();
  assert.deepEqual(h.exits, [1]);
});

test('a second signal during shutdown does not close twice', async () => {
  let resolveClose;
  const h = harness(() => new Promise((resolve) => { resolveClose = resolve; }));
  h.proc.emit('SIGTERM');
  h.proc.emit('SIGINT');
  resolveClose();
  await flush();
  assert.equal(h.closes(), 1);
  assert.deepEqual(h.exits, [0]);
});

test('a hung close is abandoned after the deadline with exit 1', async () => {
  const h = harness(() => new Promise(() => {}));
  h.proc.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(h.exits, [1]);
});
