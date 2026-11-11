import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../../../apps/control-api/src/service-lifecycle.mjs';
test('failed central DB closure still closes restricted pool',async()=>{
 let n=0;const s=createServiceLifecycle({server:{close(done){done()}},pool:{end:async()=>{throw Error('failure')}},
 runtime:{close:async()=>{n++}}});
 await assert.rejects(s.close(),AggregateError);assert.equal(n,1);
});
