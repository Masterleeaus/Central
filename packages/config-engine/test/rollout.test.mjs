import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedByRollout,rolloutPercent} from '../src/rollout.mjs';
const args={key:'feature',companyId:'company',salt:'random-secret',percentage:37};
test('rollout membership is stable',()=>assert.equal(selectedByRollout(args),selectedByRollout(args)));
test('rollout bounds and isolated hashing',()=>{assert.equal(selectedByRollout({...args,percentage:0}),false);assert.equal(selectedByRollout({...args,percentage:100}),true);assert.throws(()=>rolloutPercent(101));assert.throws(()=>selectedByRollout({...args,salt:''}));});
