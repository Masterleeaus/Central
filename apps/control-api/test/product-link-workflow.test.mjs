import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductAccountLinkWorkflow} from '../src/product-link-workflow.mjs';

const identityId='00000000-0000-4000-8000-000000000001';
const organisationId='00000000-0000-4000-8000-000000000002';
const id='00000000-0000-4000-8000-000000000003';
const actor={operatorAuthorityVerified:true,logtoSubject:'operator-1'};
const context={actorSubject:'operator-1',requestId:id,authorityReference:'operator-review:123'};
const command={kind:'link',id,identityId,organisationId,
 applicationId:'field',localUserId:'local-1',localAccountId:'account-2',
 verifiedAt:'2026-11-09T00:00:00.000Z'};
const unlink={kind:'link_revoke',id,organisationId,expectedRevision:1};
const linked={...command,revision:1,status:'verified'};
const proof={claims:{},signature:'signed'};
function harness({approval=true,proofOk=true,current=null,unlinkAllowed=true}={}){
 const calls=[];
 const w=createProductAccountLinkWorkflow({
  trustedProvisioning:{apply:async(a,c,cmd)=>{calls.push(['write',cmd]);return 'created'}},
  proofVerifier:{verify:async args=>{calls.push(['proof',args]);return proofOk}},
  authoriseLink:async()=>{calls.push(['authorize-link']);return approval},
  authoriseUnlink:async()=>{calls.push(['authorize-unlink']);return unlinkAllowed},
  resolveLink:async scope=>{calls.push(['resolve',scope]);return current}
 });
 return {w,calls};
}
test('valid signed proof is consumed after authorisation and before provisioning',async()=>{
 const {w,calls}=harness();
 assert.equal(await w.link(actor,context,command,proof),'created');
 assert.deepEqual(calls.map(x=>x[0]),['authorize-link','resolve','proof','write']);
 assert.deepEqual(calls[2][1],{proof,command});
});
test('operator must be independently authenticated and match the audited actor',async()=>{
 for(const other of [{...actor,operatorAuthorityVerified:false},
  {...actor,logtoSubject:'imposter'},null]){
  const {w,calls}=harness();
  await assert.rejects(w.link(other,context,command,proof),/invalid authorised/);
  assert.deepEqual(calls,[]);
 }
});
test('unreviewed, duplicate and mismatched links fail without consuming proof',async()=>{
 for(const opts of [{approval:false},{current:linked}]){
  const {w,calls}=harness(opts);
  await assert.rejects(w.link(actor,context,command,proof),/not authorised|requires review/);
  assert.equal(calls.some(c=>c[0]==='proof'),false);
  assert.equal(calls.some(c=>c[0]==='write'),false);
 }
});
test('invalid product proof and mismatched company never write canonical records',async()=>{
 const {w,calls}=harness({proofOk:false});
 await assert.rejects(w.link(actor,context,command,proof),/not proven/);
 assert.equal(calls.some(c=>c[0]==='write'),false);
 const x=harness();
 for(const c of [{...command,identityId:'foreign'},
  {...command,organisationId:'not-a-uuid'},
  {...command,applicationId:'untrusted'},
  {...command,localUserId:'browser user@example.org'}])
  await assert.rejects(x.w.link(actor,context,c,proof),/invalid authorised/);
 assert.deepEqual(x.calls,[]);
});
test('reviewed unlink demands matching tenant and expected revision',async()=>{
 const {w,calls}=harness({current:linked});
 assert.equal(await w.unlink(actor,context,unlink),'created');
 assert.deepEqual(calls.map(x=>x[0]),['resolve','authorize-unlink','write']);
 assert.equal(calls.at(-1)[1].expectedRevision,1);
 for(const forged of [
  {...unlink,expectedRevision:2},
  {...unlink,organisationId:'00000000-0000-4000-8000-000000000099'},
  {...unlink,expectedRevision:0}
 ]){
  const x=harness({current:linked});
  await assert.rejects(x.w.unlink(actor,context,forged),/conflict|invalid/);
  assert.equal(x.calls.some(z=>z[0]==='write'),false);
 }
});
test('revocation of unrelated application or unreviewed unlink fails closed',async()=>{
 for(const current of [{...linked,applicationId:'other'},
  {...linked,status:'revoked'},
  {...linked,organisationId:'00000000-0000-4000-8000-000000000099'}]){
  const x=harness({current});
  await assert.rejects(x.w.unlink(actor,context,unlink),/conflict/);
  assert.equal(x.calls.some(z=>z[0]==='write'),false);
 }
 const x=harness({current:linked,unlinkAllowed:false});
 await assert.rejects(x.w.unlink(actor,context,unlink),/not authorised/);
 assert.equal(x.calls.some(z=>z[0]==='write'),false);
});
test('required independent policy and storage integrations cannot be omitted',()=>{
 for(const missing of ['trustedProvisioning','proofVerifier','authoriseLink','authoriseUnlink','resolveLink']){
  const valid={trustedProvisioning:{apply:async()=>{}},
    proofVerifier:{verify:async()=>true},
    authoriseLink:async()=>true,authoriseUnlink:async()=>true,
    resolveLink:async()=>null};
  delete valid[missing];
  assert.throws(()=>createProductAccountLinkWorkflow(valid),TypeError);
 }
});
