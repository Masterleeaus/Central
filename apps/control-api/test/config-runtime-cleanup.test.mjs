import test from 'node:test';
import assert from 'node:assert/strict';
import {closeFailedStartup} from '../src/config-runtime-cleanup.mjs';
test('both cleanup paths run even if one rejects',async()=>{
 let calls=0;const results=await closeFailedStartup({pool:{end:async()=>{calls++}},runtime:{close:async()=>{calls++;throw Error('failed')}}});
 assert.equal(calls,2);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
});
