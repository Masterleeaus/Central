import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDecision} from '../src/public-decision.mjs';
test('only primitive decisions returned',()=>{
 assert.deepEqual(publicDecision({key:'flag',value:false,revision:0,source:'default',secret:'hidden'}),{key:'flag',value:false,revision:0,source:'default'});
 assert.throws(()=>publicDecision({key:'flag',value:{secret:'x'},revision:1,source:'override'}));
});
