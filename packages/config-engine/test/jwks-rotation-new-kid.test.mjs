import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const key=(kid)=>({kid,kty:'RSA',use:'sig',alg:'RS256',n:'AQAB',e:'AQAB'});
const endpoint='https://login.example.test/oidc/jwks';
const issuer='https://login.example.test/';
test('unknown kid refreshes cached JWKS to discover newly rotated signing key',async()=>{let fetches=0;const get=createJwksProvider({issuer,jwksUri:endpoint,fetcher:async()=>({ok:true,json:async()=>({keys:++fetches===1?[key('old')]:[key('old'),key('new')]})})});assert.equal((await get('old')).kid,'old');assert.equal((await get('new')).kid,'new');assert.equal(fetches,2)});
