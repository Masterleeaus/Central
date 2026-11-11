import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigStartupStatus} from '../../../apps/control-api/src/config-startup-status.mjs';
test('failed readiness status cannot become ready',()=>{
 const s=createConfigStartupStatus();s.fail('migration');assert.throws(()=>s.ready());
});
