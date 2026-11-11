import test from 'node:test';
import assert from 'node:assert/strict';
import {assertIndependentServicePools} from '../src/service-login-policy.mjs';
test('malformed login pool input denied',()=>{
 assert.throws(()=>assertIndependentServicePools(null));
 assert.throws(()=>assertIndependentServicePools({config:{connect(){}},grants:{connect(){}},writer:{connect(){}},authority:{}}));
});
