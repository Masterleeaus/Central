import test from 'node:test';
import assert from 'node:assert/strict';
import {issuerPolicy,assertClaims} from '../src/issuer-policy.mjs';
test('issuer and expiry are bounded',()=>{
 const p=issuerPolicy({issuer:'https://login.example.test/',audience:'https://central.example.test/config'});
 assert.throws(()=>issuerPolicy({issuer:'http://login.example.test/',audience:p.audience}));
 assert.equal(assertClaims({iss:p.issuer,aud:p.audience,sub:'service_1',iat:100,exp:200},p,150).sub,'service_1');
 assert.throws(()=>assertClaims({iss:p.issuer,aud:p.audience,sub:'service_1',iat:100,exp:120},p,200));
});
