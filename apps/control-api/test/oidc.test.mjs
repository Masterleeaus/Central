import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createOidcVerifier} from '../src/oidc.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});const jwk=pair.publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
const issuer='https://login.example.test/oidc';const audience='titan-control';
const fakeFetch=async()=>({ok:true,json:async()=>({keys:[jwk]})});
function token(payload={},header={}) {const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key',...header})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:'user1',exp:2000000000,...payload})).toString('base64url');return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),pair.privateKey).toString('base64url')}`;}
const v=createOidcVerifier({issuer,audience,jwksUri:'https://login.example.test/jwks',fetcher:fakeFetch,clock:()=>1700000000000});
test('accepts correctly signed token',async()=>{assert.equal((await v(token())).logtoSubject,'user1')});
test('rejects tampered payload',async()=>{const t=token().split('.');t[1]=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:'attacker',exp:2000000000})).toString('base64url');await assert.rejects(v(t.join('.')))});
test('rejects expired token',async()=>await assert.rejects(v(token({exp:1500000000}))));
test('rejects foreign audience',async()=>await assert.rejects(v(token({aud:'other'}))));
test('rejects foreign issuer',async()=>await assert.rejects(v(token({iss:'https://evil.example'}))));
test('rejects alg none',async()=>await assert.rejects(v(token({}, {alg:'none'}))));
test('rejects attacker JWKS URL header',async()=>await assert.rejects(v(token({}, {jku:'https://evil.example/jwks'}))));
test('rejects unknown signing key',async()=>await assert.rejects(v(token({}, {kid:'not-here'}))));
test('rejects insecure issuer settings',()=>assert.throws(()=>createOidcVerifier({issuer:'http://example.com',audience,jwksUri:'https://example.com',fetcher:fakeFetch})));
