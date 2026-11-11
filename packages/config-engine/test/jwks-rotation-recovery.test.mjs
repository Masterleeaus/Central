import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('unknown-kid refresh retries after bounded cooldown',async()=>{let now=0,count=0;const get=createJwksProvider({issuer,jwksUri:endpoint,clock:()=>now,fetcher:async()=>({ok:true,json:async()=>({keys:++count<3?[key('old')]:[key('new')]})})});await get('old');await assert.rejects(get('new'));now=3001;assert.equal((await get('new')).kid,'new');assert.equal(count,3)});
