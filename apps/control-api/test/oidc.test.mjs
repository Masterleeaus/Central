import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createOidcVerifier} from '../src/oidc.mjs';
import {insecureLocalhostAllowed} from '../src/endpoint-policy.mjs';
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

const fetchCounter=(c)=>async()=>{c.n++;return {ok:true,json:async()=>({keys:[jwk]})}};
test('unknown kids cause at most one forced JWKS fetch per cooldown window',async()=>{
 let now=1700000000000;const c={n:0};
 const verifier=createOidcVerifier({issuer,audience,jwksUri:'https://login.example.test/jwks',fetcher:fetchCounter(c),clock:()=>now});
 for(let i=0;i<25;i++) await assert.rejects(verifier(token({},{kid:'unknown-'+i})));
 assert.equal(c.n,1,'initial load only; forced refresh suppressed inside the cooldown');
 now+=30_001;
 await assert.rejects(verifier(token({},{kid:'unknown-after-window'})));
 assert.equal(c.n,2,'exactly one forced refresh once the window has elapsed');
 for(let i=0;i<25;i++) await assert.rejects(verifier(token({},{kid:'later-'+i})));
 assert.equal(c.n,2);
});
test('a repeated unknown kid is negative-cached within the window',async()=>{
 let now=1700000000000;const c={n:0};
 const verifier=createOidcVerifier({issuer,audience,jwksUri:'https://login.example.test/jwks',fetcher:fetchCounter(c),clock:()=>now});
 await verifier(token());
 assert.equal(c.n,1);
 now+=30_001;
 for(let i=0;i<10;i++) await assert.rejects(verifier(token({},{kid:'ghost'})));
 assert.equal(c.n,2,'one forced refresh for the repeated kid');
});
test('localhost issuer and JWKS are refused without the dev flag',()=>{
 const base={audience,fetcher:fakeFetch};
 assert.throws(()=>createOidcVerifier({...base,issuer:'http://localhost:9000/oidc',jwksUri:'http://localhost:9000/jwks'}),/secure OIDC issuer required/);
 assert.throws(()=>createOidcVerifier({...base,issuer:'http://localhost:9000/oidc',jwksUri:'http://localhost:9000/jwks',allowInsecureLocalhost:false}),/secure OIDC issuer required/);
 assert.throws(()=>createOidcVerifier({...base,issuer,jwksUri:'http://localhost:9000/jwks',allowInsecureLocalhost:false}),/secure JWKS URI required/);
});
test('localhost issuer and JWKS are accepted with the explicit dev flag and verify tokens',async()=>{
 const local='http://localhost:9000/oidc';
 const dev=createOidcVerifier({issuer:local,audience,jwksUri:'http://localhost:9000/jwks',fetcher:fakeFetch,clock:()=>1700000000000,allowInsecureLocalhost:true});
 assert.equal((await dev(token({iss:local}))).logtoSubject,'user1');
});
test('non-localhost http is refused even with the dev flag',()=>{
 assert.throws(()=>createOidcVerifier({issuer:'http://example.com',audience,jwksUri:'https://login.example.test/jwks',fetcher:fakeFetch,allowInsecureLocalhost:true}),/secure OIDC issuer required/);
});
test('dev flag is read from the environment only when exactly 1',()=>{
 assert.equal(insecureLocalhostAllowed({TITAN_ALLOW_INSECURE_LOCALHOST:'1'}),true);
 assert.equal(insecureLocalhostAllowed({TITAN_ALLOW_INSECURE_LOCALHOST:'true'}),false);
 assert.equal(insecureLocalhostAllowed({}),false);
});
