import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigStartupStatus} from '../src/config-startup-status.mjs';
test('readiness phase cannot be marked ready twice or after failure',()=>{
 const r=createConfigStartupStatus();r.ready();assert.equal(r.get().phase,'ready');
 assert.throws(()=>r.ready());r.closed();assert.equal(r.get().phase,'closed');
 const bad=createConfigStartupStatus();bad.fail('migration');assert.throws(()=>bad.ready());
});
