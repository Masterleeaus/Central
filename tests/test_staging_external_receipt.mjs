import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {canonical,pin,signedReceipt,validateSigned,validateReceipt,parseArgs,main}
 from '../tools/staging_external_receipt.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const wrong=generateKeyPairSync('ed25519').publicKey;
const receipt={
 schema:'titan.staging-external-receipt.v1',
 database:'titan_shared_ci',
 approval_id:'00000000-0000-4000-8000-000000000705',
 event_id:'00000000-0000-4000-8000-000000000999',
 approval_sha256:'a'.repeat(64),
 audit_sha256:'b'.repeat(64),
 captured_at:'2026-11-09T00:00:00.000Z'
};
test('Ed25519 signs exact canonical receipt and independently pinned public key',()=>{
 const signed=signedReceipt(receipt,privateKey);
 assert.equal(signed.signature_ed25519.length,88);
 assert.equal(validateSigned(signed,publicKey,pin(publicKey)),receipt);
 assert.equal(canonical({z:1,a:2}),canonical({a:2,z:1}));
});
test('tampering with either fingerprint, event ID, timestamp or database invalidates signature',()=>{
 const valid=signedReceipt(receipt,privateKey);
 for(const delta of [
  {approval_sha256:'c'.repeat(64)},
  {audit_sha256:'d'.repeat(64)},
  {event_id:'00000000-0000-4000-8000-000000000998'},
  {captured_at:'2026-11-09T00:00:01.000Z'},
  {database:'titan_shared_staging'}
 ]) {
  const changed={...valid,receipt:{...receipt,...delta}};
  assert.throws(()=>validateSigned(changed,publicKey,pin(publicKey)),/signature mismatch/);
 }
});
test('wrong public key and unpinned key rejected even with valid signature',()=>{
 const signed=signedReceipt(receipt,privateKey);
 assert.throws(()=>validateSigned(signed,wrong,pin(publicKey)),/untrusted/);
 assert.throws(()=>validateSigned(signed,publicKey,pin(wrong)),/untrusted/);
 assert.throws(()=>validateSigned(signed,publicKey,'0'.repeat(64)),/untrusted/);
});
test('malformed receipt, signature and unsafe database class rejected',()=>{
 for(const altered of [
  {...receipt,database:'titan_shared_production'},
  {...receipt,unknown:'unapproved'},
  {...receipt,approval_sha256:'not-sha256'},
  {...receipt,approval_id:"';DROP TABLE titan.identities;--"},
  {...receipt,captured_at:'yesterday'}
 ]) assert.throws(()=>validateReceipt(altered));
 const signed=signedReceipt(receipt,privateKey);
 assert.throws(()=>validateSigned({...signed,signature_ed25519:'ABC'},publicKey,pin(publicKey)));
 assert.throws(()=>validateSigned({...signed,unknown:1},publicKey,pin(publicKey)));
});
test('standalone sign refuses to overwrite preexisting receipt',()=>{
 const folder=mkdtempSync(join(tmpdir(),'titan-receipt-'));
 try {
  const input=join(folder,'receipt.json'),output=join(folder,'signed.json');
  const privatePath=join(folder,'key.pem');
  writeFileSync(input,JSON.stringify(receipt));
  writeFileSync(privatePath,privateKey.export({format:'pem',type:'pkcs8'}));
  assert.equal(main(['sign','--receipt',input,'--private-key',privatePath,'--output',output]),0);
  assert.equal(main(['sign','--receipt',input,'--private-key',privatePath,'--output',output]),1);
  assert.equal(validateSigned(JSON.parse(readFileSync(output)),publicKey,pin(publicKey)).approval_id,receipt.approval_id);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('production database URL cannot be used to capture an unverified commitment',()=>{
 const folder=mkdtempSync(join(tmpdir(),'titan-receipt-'));
 try {
  const cli=resolve(dirname(fileURLToPath(import.meta.url)),'../tools/staging_external_receipt.mjs');
  const r=spawnSync(process.execPath,[cli,'capture','--database-url','postgresql://localhost/titan_live_production',
    '--approval-id',receipt.approval_id,'--output',join(folder,'receipt.json')],{encoding:'utf8'});
  assert.equal(r.status,1);
  assert.doesNotMatch(r.stderr,/password|subject|postgresql:\/\//);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('CLI accepts trusted-key-sha256 without relaxing unknown or duplicate options',()=>{
 const parsed=parseArgs(['verify','--signed','x.json','--public-key','public.pem',
   '--trusted-key-sha256','a'.repeat(64),'--database-url','postgresql://localhost/titan_shared_ci']);
 assert.equal(parsed['trusted-key-sha256'],'a'.repeat(64));
 assert.throws(()=>parseArgs(['verify','--invalid_key','x']));
 assert.throws(()=>parseArgs(['verify','--signed','x','--signed','y']));
});
