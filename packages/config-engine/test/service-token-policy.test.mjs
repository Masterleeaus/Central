import test from 'node:test';
import assert from 'node:assert/strict';
import {assertServiceClientClaims} from '../src/service-token-policy.mjs';
test('signed client ID must not conflict with authorised party claim',()=>{
 assert.equal(assertServiceClientClaims({client_id:'svc_a'}),'svc_a');
 assert.equal(assertServiceClientClaims({azp:'svc_a'}),'svc_a');
 assert.throws(()=>assertServiceClientClaims({client_id:'svc_a',azp:'svc_c'}));
 assert.throws(()=>assertServiceClientClaims({client_id:'invalid value'}));
});
