import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createProductAccountProofIssuer} from '../src/product-link-proof-issuer.mjs';
import {createProductLinkProofVerifier,trustedProductKeyPin} from '../src/product-link-proof.mjs';
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'pem',type:'pkcs8'});
const now=Date.parse('2026-11-09T03:00:00.000Z');
const id='00000000-0000-4000-8000-000000000001';
const org='00000000-0000-4000-8000-000000000002';
const requested={identityId:id,organisationId:org,localUserId:'actual-product-user',
 localAccountId:'account-123'};
const base={applicationId:'field',privateKey,clock:()=>now,randomNonce:()=> 'k'.repeat(43)};
test('product signs only after independent exact local-account control verification',async()=>{
 const seen=[];
 const issuer=createProductAccountProofIssuer({...base,
  verifyAccountControl:async values=>{seen.push(values);return true}});
 const proof=await issuer.issue(requested);
 assert.deepEqual(seen,[{applicationId:'field',...requested}]);
 assert.equal(proof.claims.issuedAt,'2026-11-09T03:00:00.000Z');
 assert.equal(proof.claims.expiresAt,'2026-11-09T03:01:00.000Z');
 const verifier=createProductLinkProofVerifier({clock:()=>now,claimNonce:async()=>true,
  productKeys:{field:{publicKey:issuer.publicKey,pin:trustedProductKeyPin(issuer.publicKey)}}});
 assert.equal(await verifier.verify({proof,command:{kind:'link',applicationId:'field',...requested}}),true);
});
test('failed local-account validation never emits a signed proof',async()=>{
 let calls=0;
 const issuer=createProductAccountProofIssuer({...base,verifyAccountControl:async()=>{calls++;return false}});
 await assert.rejects(issuer.issue(requested),/not verified/);
 assert.equal(calls,1);
});
test('malformed or foreign identity cannot be signed even with permissive caller',async()=>{
 const issuer=createProductAccountProofIssuer({...base,verifyAccountControl:async()=>true});
 for(const bad of [
  {...requested,identityId:'not-a-uuid'},
  {...requested,organisationId:'not-a-uuid'},
  {...requested,localUserId:'a'.repeat(201)},
  {...requested,localAccountId:'invalid email@example.net'},
 ])await assert.rejects(issuer.issue(bad),/invalid product account proof/);
});
test('wrong app, wrong key type and untrusted issuer dependencies reject at construction',()=>{
 for(const bad of [
  {...base,applicationId:'other',verifyAccountControl:async()=>true},
  {...base,verifyAccountControl:null},
  {...base,clock:123,verifyAccountControl:async()=>true},
 ])assert.throws(()=>createProductAccountProofIssuer(bad),TypeError);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>createProductAccountProofIssuer({...base,
  privateKey:rsa.privateKey.export({format:'pem',type:'pkcs8'}),verifyAccountControl:async()=>true}),TypeError);
});
test('product verifier refuses proof from another audience even if claims match other company',async()=>{
 const fieldIssuer=createProductAccountProofIssuer({...base,verifyAccountControl:async()=>true});
 const signed=await fieldIssuer.issue(requested);
 const verifier=createProductLinkProofVerifier({clock:()=>now,claimNonce:async()=>true,
  productKeys:{field:{publicKey:fieldIssuer.publicKey,pin:trustedProductKeyPin(fieldIssuer.publicKey)}}});
 assert.equal(await verifier.verify({proof:signed,command:{kind:'link',applicationId:'desk',...requested}}),false);
});
