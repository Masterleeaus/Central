import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('failed key refresh denies unknown signing key rather than using old key',async()=>{let count=0;const get=createJwksProvider({issuer,jwksUri:endpoint,fetcher:async()=>{count++;if(count===1)return{ok:true,json:async()=>({keys:[key('old')]})};throw Error('jwks offline')}});await get('old');await assert.rejects(get('new'));assert.equal(count,2)});
