import test from 'node:test';
import assert from 'node:assert/strict';
import {issuerPolicy,assertClaims} from '../src/issuer-policy.mjs';
test('future not-before is rejected',()=>{
 const p=issuerPolicy({issuer:'https://login.test/',audience:'https://api.test/config'});
 assert.throws(()=>assertClaims({iss:p.issuer,aud:p.audience,sub:'svc',iat:100,exp:300,nbf:250},p,110));
});
