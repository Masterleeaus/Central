import test from 'node:test';
import assert from 'node:assert/strict';
import {assertServiceClientClaims} from '../src/service-token-policy.mjs';
test('conflicting token identity fields fail closed without database IO',()=>{
 assert.throws(()=>assertServiceClientClaims({client_id:'trusted',azp:'attacker'}));
 assert.throws(()=>assertServiceClientClaims({client_id:null}));
});
