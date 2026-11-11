import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('failed HTTP close does not skip either PostgreSQL pool',async()=>{
 let central=0,config=0;
 const x=createServiceLifecycle({server:{close(done){done(Error('socket busy'))}},
 pool:{end:async()=>{central++}},runtime:{close:async()=>{config++}}});
 await assert.rejects(x.close(),AggregateError);
 assert.deepEqual([central,config],[1,1]);
});
