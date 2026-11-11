import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createProductLinkProofVerifier,stableJson,trustedProductKeyPin,
 validateProductLinkClaims} from '../src/product-link-proof.mjs';
const now=Date.parse('2026-11-09T03:00:00.000Z');
const identityId='00000000-0000-4000-8000-000000000001';
const organisationId='00000000-0000-4000-8000-000000000002';
const keys=Object.fromEntries(['field','desk','academy'].map(app=>{
 const keypair=generateKeyPairSync('ed25519');
 return [app,keypair];
}));
const command={kind:'link',identityId,organisationId,applicationId:'field',
 localUserId:'user-123',localAccountId:'account-456'};
const claims=Object.freeze({schema:'titan.product-account-control.v1',applicationId:'field',
 identityId,organisationId,localUserId:command.localUserId,
 localAccountId:command.localAccountId,nonce:'a'.repeat(43),
 issuedAt:'2026-11-09T02:59:20.000Z',expiresAt:'2026-11-09T03:00:40.000Z',action:'link'});
const proof=(assertion=claims,app='field')=>({claims:assertion,signature:sign(null,
 Buffer.from('titan:product-account-control:v1\n'+stableJson(assertion)),
 keys[app].privateKey).toString('base64')});
function verifier(claimNonce=async()=>true) {
 return createProductLinkProofVerifier({clock:()=>now,claimNonce,
  productKeys:Object.fromEntries(Object.entries(keys).map(([app,k])=>
    [app,{publicKey:k.publicKey.export({format:'pem',type:'spki'}),
      pin:trustedProductKeyPin(k.publicKey.export({format:'pem',type:'spki'}))}]))});
}
test('valid account control proof verifies command exactly and atomically consumes nonce',async()=>{
 const consumed=[];const v=verifier(async(...args)=>{consumed.push(args);return true;});
 assert.equal(await v.verify({proof:proof(),command}),true);
 assert.deepEqual(consumed,[['field',claims.nonce,claims.expiresAt]]);
});
test('spoofed email and browser supplied local account cannot be authority',async()=>{
 let claimsCount=0;const v=verifier(async()=>{claimsCount++;return true});
 for(const altered of [
  {...command,identityId:'00000000-0000-4000-8000-000000000099'},
  {...command,organisationId:'00000000-0000-4000-8000-000000000099'},
  {...command,localUserId:'another-user'},
  {...command,localAccountId:'another-account'},
  {...command,applicationId:'desk'},
  {...command,kind:'link_revoke'}
 ])assert.equal(await v.verify({proof:proof(),command:altered}),false);
 assert.equal(claimsCount,0);
});
test('tampered unsigned fields or unauthorized product key cannot authenticate',async()=>{
 const v=verifier();
 for(const change of [
  {localUserId:'attacker'},{localAccountId:'attacker'},
  {organisationId:'00000000-0000-4000-8000-000000000099'},
  {expiresAt:'2026-11-09T03:01:00.000Z'},
  {nonce:'b'.repeat(43)}, {applicationId:'desk'}
 ])assert.equal(await v.verify({proof:{...proof(),claims:{...claims,...change}},command}),false);
 assert.equal(await v.verify({proof:proof(claims,'desk'),command}),false);
});
test('missing registered product, stale, expired, future or oversized proof fails',async()=>{
 const v=createProductLinkProofVerifier({clock:()=>now,claimNonce:async()=>true,productKeys:{}});
 assert.equal(await v.verify({proof:proof(),command}),false);
 for(const delta of [
  {issuedAt:'2026-11-09T02:57:00.000Z'},
  {issuedAt:'2026-11-09T03:00:31.000Z'},
  {expiresAt:'2026-11-09T03:00:00.000Z'},
  {expiresAt:'2026-11-09T03:04:00.000Z'},
  {nonce:'short'}, {localUserId:'x'.repeat(201)},
  {email:'anything@invalid.test'}
 ])assert.equal(await verifier().verify({proof:proof({...claims,...delta}),command}),false);
});
test('replay blocking, database errors and false nonce claims fail closed',async()=>{
 for(const claimNonce of [async()=>false,async()=>{throw Error('db unavailable')},async()=>undefined])
  assert.equal(await verifier(claimNonce).verify({proof:proof(),command}),false);
 const consumed=new Set();const v=verifier(async(_,nonce)=>{
  if(consumed.has(nonce))return false;
  consumed.add(nonce);return true;
 });
 const attempts=await Promise.all(Array.from({length:15},()=>v.verify({proof:proof(),command})));
 assert.equal(attempts.filter(Boolean).length,1);
});
test('untrusted product keys, unsupported ids and unpinned key changes fail at setup',()=>{
 const first=keys.field.publicKey.export({format:'pem',type:'spki'});
 const second=keys.desk.publicKey.export({format:'pem',type:'spki'});
 assert.throws(()=>createProductLinkProofVerifier({productKeys:{
  field:{publicKey:first,pin:trustedProductKeyPin(second)}},claimNonce:async()=>true}));
 assert.throws(()=>createProductLinkProofVerifier({productKeys:{
  unknown:{publicKey:first,pin:trustedProductKeyPin(first)}},claimNonce:async()=>true}));
 assert.throws(()=>createProductLinkProofVerifier({productKeys:{},claimNonce:null}));
});
test('strict claim structure and clock reject corrupt assertions',()=>{
 assert.deepEqual(validateProductLinkClaims(claims,now),claims);
 assert.throws(()=>validateProductLinkClaims({...claims,role:'admin'},now));
 assert.throws(()=>validateProductLinkClaims({...claims,action:'unlink'},now));
 assert.throws(()=>validateProductLinkClaims(claims,NaN));
});
