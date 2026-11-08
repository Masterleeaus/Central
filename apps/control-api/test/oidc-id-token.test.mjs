import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createIdTokenVerifier} from '../src/oidc-id-token.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk=publicKey.export({format:'jwk'});jwk.kid='key1';jwk.use='sig';const now=1_800_000_000_000;const issuer='https://identity.titanzero.io', clientId='desk-client';
const make=(overrides={},header={})=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'key1',...header})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:issuer,aud:clientId,sub:'sub-1',nonce:'a-nonce',iat:now/1000,exp:now/1000+60,...overrides})).toString('base64url');const signer=createSign('RSA-SHA256');signer.update(`${h}.${p}`);return `${h}.${p}.${signer.sign(privateKey).toString('base64url')}`;};
const verifier=()=>createIdTokenVerifier({issuer,clientId,jwksUri:'https://identity.titanzero.io/oidc/jwks',clock:()=>now,fetcher:async()=>({ok:true,json:async()=>({keys:[jwk]})})});
test('verifies signed ID token and returns claims',async()=>{assert.equal((await verifier()(make())).sub,'sub-1');});
test('rejects forged signature',async()=>{const token=make();await assert.rejects(verifier()(token.slice(0,-3)+'abc'));});
test('rejects invalid audience, issuer and expiry',async()=>{for(const claims of [{aud:'wrong'},{iss:'https://evil.test'},{exp:now/1000-1}])await assert.rejects(verifier()(make(claims)));});
test('rejects multiple audiences without azp',async()=>{await assert.rejects(verifier()(make({aud:[clientId,'other']})));});
test('accepts multiple audiences only with matching azp',async()=>{assert.equal((await verifier()(make({aud:[clientId,'other'],azp:clientId}))).sub,'sub-1');});
test('rejects none algorithm and external key URLs',async()=>{await assert.rejects(verifier()(make({}, {alg:'none'})));await assert.rejects(verifier()(make({}, {jku:'https://evil.test/jwks'})));});
test('rejects missing nonce or stale iat',async()=>{await assert.rejects(verifier()(make({nonce:null})));await assert.rejects(verifier()(make({iat:now/1000-10000})));});
test('rejects untrusted JWKS host configuration',()=>{assert.throws(()=>createIdTokenVerifier({issuer,clientId,jwksUri:'http://evil.test'}));});

test('unknown kids trigger at most one forced JWKS fetch per cooldown window',async()=>{
 let clockNow=now;let n=0;
 const v=createIdTokenVerifier({issuer,clientId,jwksUri:'https://identity.titanzero.io/oidc/jwks',clock:()=>clockNow,fetcher:async()=>{n++;return {ok:true,json:async()=>({keys:[jwk]})}}});
 for(let i=0;i<20;i++) await assert.rejects(v(make({},{kid:'unknown-'+i})));
 assert.equal(n,1);
 clockNow+=30_001;
 for(let i=0;i<20;i++) await assert.rejects(v(make({},{kid:'ghost'})));
 assert.equal(n,2);
});
test('localhost endpoints in the ID token verifier require the dev flag',()=>{
 const local={issuer:'http://localhost:9000',clientId,jwksUri:'http://localhost:9000/jwks'};
 assert.throws(()=>createIdTokenVerifier(local),TypeError);
 assert.throws(()=>createIdTokenVerifier({...local,allowInsecureLocalhost:false}),TypeError);
 assert.equal(typeof createIdTokenVerifier({...local,allowInsecureLocalhost:true}),'function');
});
