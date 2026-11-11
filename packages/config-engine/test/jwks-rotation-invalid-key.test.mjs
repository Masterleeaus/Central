import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJwksKeySet} from '../src/jwks-refresh-policy.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('non RSA signing algorithms and missing modulus are not accepted',()=>{assert.deepEqual(assertJwksKeySet([{...key('one'),alg:'HS256'}, {...key('two'),n:undefined}]),[])});
