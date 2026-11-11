import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('retired keys fail after cache expiry when issuer drops them',async()=>{let now=1000,round=0;const get=createJwksProvider({issuer,jwksUri:endpoint,ttlMs:1000,clock:()=>now,fetcher:async()=>({ok:true,json:async()=>({keys:++round===1?[key('old')]:[key('new')]})})});await get('old');now+=1100;await assert.rejects(get('old'));assert.equal((await get('new')).kid,'new')});
