import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('repeat close after failure does not repeat shutdown side effects',async()=>{
 let n=0;const s=createServiceLifecycle({server:{close(cb){n++;cb(Error('fail'))}},pool:{end:async()=>{n++}}});
 await assert.rejects(s.close());await assert.rejects(s.close());assert.equal(n,2);
});
