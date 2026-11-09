import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('failed main database shutdown does not skip config connection close',async()=>{
 let config=0;
 const x=createServiceLifecycle({server:{close(done){done()}},pool:{end:async()=>{throw Error('pg failed')}},
 runtime:{close:async()=>{config++}}});
 await assert.rejects(x.close(),AggregateError);assert.equal(config,1);
});
