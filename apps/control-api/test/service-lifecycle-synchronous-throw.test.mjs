import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('synchronous socket close exception is contained and databases still close',async()=>{
 let calls=0;const s=createServiceLifecycle({server:{close(){throw Error('closed')}},
 pool:{end:async()=>{calls++}},runtime:{close:async()=>{calls++}}});
 await assert.rejects(s.close(),AggregateError);assert.equal(calls,2);
});
