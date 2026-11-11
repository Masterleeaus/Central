import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLifecycle} from '../src/service-lifecycle.mjs';
test('parallel close calls share one closure and dispose all pools once',async()=>{
 let http=0,central=0,config=0;
 const x=createServiceLifecycle({server:{close(done){http++;done()}},
 pool:{end:async()=>{central++}},runtime:{close:async()=>{config++}}});
 await Promise.all([x.close(),x.close(),x.close()]);
 assert.deepEqual([http,central,config],[1,1,1]);
});
