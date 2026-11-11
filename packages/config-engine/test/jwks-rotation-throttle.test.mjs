import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('repeated missing kids cannot force unlimited JWKS network fetches',async()=>{let count=0;const get=createJwksProvider({issuer,jwksUri:endpoint,clock:()=>10000,fetcher:async()=>{count++;return{ok:true,json:async()=>({keys:[key('one')]})}}});await get('one');for(let i=0;i<15;i++)await assert.rejects(get('nonexistent'+i));assert.equal(count,2)});
