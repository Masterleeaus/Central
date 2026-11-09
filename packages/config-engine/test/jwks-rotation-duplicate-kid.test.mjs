import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJwksKeySet} from '../src/jwks-refresh-policy.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('duplicate signing kid is rejected as ambiguous',()=>assert.throws(()=>assertJwksKeySet([key('same'),key('same')])));
