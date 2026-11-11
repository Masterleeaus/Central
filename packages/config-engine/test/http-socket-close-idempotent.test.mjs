import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../../../apps/control-api/src/service-lifecycle.mjs';
test('socket and database close at most once',async()=>{
 let n=0;const s=createServiceLifecycle({server:{close(done){done()}},pool:{end:async()=>{n++}}});
 await Promise.all([s.close(),s.close()]);assert.equal(n,1);
});
