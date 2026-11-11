import test from 'node:test';
import assert from 'node:assert/strict';
import {denyOnFailure} from '../src/fallback.mjs';
test('defaults deny, never enable',()=>{assert.equal(denyOnFailure({key:'flag',type:'boolean',defaultValue:false}).value,false);
 assert.throws(()=>denyOnFailure({key:'flag',type:'boolean',defaultValue:true}));});
