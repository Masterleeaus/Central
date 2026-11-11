import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('cache expiry and failed refresh must never fall back to stale key',async()=>{let calls=0,now=0;const get=createJwksProvider({issuer,jwksUri:endpoint,ttlMs:1000,clock:()=>now,fetcher:async()=>{if(++calls>1)throw Error('offline');return{ok:true,json:async()=>({keys:[key('old')]})}}});await get('old');now=1001;await assert.rejects(get('old'))});
