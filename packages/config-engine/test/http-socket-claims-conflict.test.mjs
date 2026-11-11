import test from 'node:test';
import assert from 'node:assert/strict';
import {assertServiceClientClaims} from '../src/service-token-policy.mjs';
test('different client_id and azp are never accepted',()=>{
 assert.throws(()=>assertServiceClientClaims({client_id:'svc_a',azp:'svc_c'}));
});
