import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('concurrent cache misses share one JWKS refresh',async()=>{let count=0;const get=createJwksProvider({issuer,jwksUri:endpoint,fetcher:async()=>{count++;return{ok:true,json:async()=>({keys:[key('one')]})}}});await Promise.all([get('one'),get('one'),get('one')]);assert.equal(count,1)});
