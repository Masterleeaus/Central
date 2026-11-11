import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
test('fixed issuer JWKS and shared cache',async()=>{
 let count=0;
 const get=createJwksProvider({issuer:'https://login.example.test/',jwksUri:'https://login.example.test/oidc/jwks',fetcher:async url=>{assert.equal(url,'https://login.example.test/oidc/jwks');count++;return{ok:true,json:async()=>({keys:[{kid:'key1',kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'}]})}}});
 assert.equal((await get('key1')).kid,'key1');assert.equal((await get('key1')).kid,'key1');assert.equal(count,1);
 await assert.rejects(get('missing'));
});
