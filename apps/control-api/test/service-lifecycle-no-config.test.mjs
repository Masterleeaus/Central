import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('disabled config lifecycle closes only HTTP and central DB',async()=>{
 let n=0;const x=createServiceLifecycle({server:{close(done){n++;done()}},pool:{end:async()=>{n++}}});
 await x.close();assert.equal(n,2);
});
