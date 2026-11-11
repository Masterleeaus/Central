import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationHealth} from '../src/health.mjs';
test('health hides database errors',async()=>{
 assert.deepEqual(await configurationHealth({query:async()=>({rows:[{ready:true}]})}),{ready:true});
 assert.deepEqual(await configurationHealth({query:async()=>{throw Error('secret')}}),{ready:false});
});
