import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRuntimePoolIsolation} from '../src/runtime-separation-policy.mjs';
test('control, config and grant pools must be distinct',()=>{
 const a={},b={},c={};
 assert.equal(assertRuntimePoolIsolation({controlPool:a,configPool:b,grantPool:c}),true);
 assert.throws(()=>assertRuntimePoolIsolation({controlPool:a,configPool:a,grantPool:c}));
});
