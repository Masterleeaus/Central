import test from 'node:test';
import assert from 'node:assert/strict';
import {assertServiceClientClaims} from '../src/service-token-policy.mjs';
test('matching client_id and azp permit the identical verified machine client',()=>{
 assert.equal(assertServiceClientClaims({client_id:'service_1',azp:'service_1'}),'service_1');
});
