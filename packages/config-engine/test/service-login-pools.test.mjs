import test from 'node:test';
import assert from 'node:assert/strict';
import {assertIndependentServicePools} from '../src/service-login-policy.mjs';
test('every role must have a separate pool',()=>{
 const ps=Object.fromEntries(['config','grants','writer','authority'].map(k=>[k,{connect(){}}]));
 assert.equal(assertIndependentServicePools(ps).config,ps.config);
 assert.throws(()=>assertIndependentServicePools({...ps,writer:ps.config}));
});
