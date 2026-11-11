import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJwksKeySet} from '../src/jwks-refresh-policy.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('large JWKS responses are rejected before caching',()=>assert.throws(()=>assertJwksKeySet(Array.from({length:33},(_,i)=>key('kid'+i)))));
