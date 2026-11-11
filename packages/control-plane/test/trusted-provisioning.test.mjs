import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustedProvisioningService } from '../dist/trusted-provisioning.js';
const a='a0000000-0000-4000-8000-000000000000',b='b0000000-0000-4000-8000-000000000000';
const actor={logtoSubject:'admin_id',operatorAuthorityVerified:true},context={actorSubject:'admin_id',authorityReference:'trusted-policy:1',requestId:a};
function harness({allowed=true,link=true,member=true}={}){const calls=[];
 const repo={apply:async()=>{calls.push('write');return 'created'}};
 const logto={assertIdentity:async()=>calls.push('identity'),assertOrganisation:async()=>calls.push('organisation'),assertMembership:async()=>{calls.push('membership');if(!member)throw Error('no membership')}};
 const svc=new TrustedProvisioningService(repo,logto,async()=>{calls.push('authorize');return allowed},async()=>{calls.push('resolve');return 'trusted_external_id'},async()=>{calls.push('linkcheck');return link});return {svc,calls};}
test('identity requires authority and live Logto validation',async()=>{const {svc,calls}=harness();assert.equal(await svc.apply(actor,context,{kind:'identity',id:a,logtoSubject:'x'}),'created');assert.deepEqual(calls,['authorize','identity','write']);});
test('forbids untrusted actor before accessing backend',async()=>{const {svc,calls}=harness();await assert.rejects(svc.apply({...actor,operatorAuthorityVerified:false},context,{kind:'identity',id:a,logtoSubject:'x'}),/unverified/);assert.deepEqual(calls,[]);});
test('rejects actor impersonation',async()=>{const {svc}=harness();await assert.rejects(svc.apply(actor,{...context,actorSubject:'another'}, {kind:'identity',id:a,logtoSubject:'x'}),/unverified/);});
test('rejects policy-denied actor',async()=>{const {svc,calls}=harness({allowed:false});await assert.rejects(svc.apply(actor,context,{kind:'identity',id:a,logtoSubject:'x'}),/forbidden/);assert.deepEqual(calls,['authorize']);});
test('membership requires verified current Logto membership',async()=>{const {svc,calls}=harness();await svc.apply(actor,context,{kind:'membership',id:a,identityId:a,organisationId:b,role:'member'});assert.deepEqual(calls,['authorize','resolve','resolve','membership','write']);});
test('revoked membership is not written',async()=>{const {svc,calls}=harness({member:false});await assert.rejects(svc.apply(actor,context,{kind:'membership',id:a,identityId:a,organisationId:b,role:'member'}),/no membership/);assert.ok(!calls.includes('write'));});
test('link additionally requires verified local app account',async()=>{const {svc,calls}=harness({link:false});await assert.rejects(svc.apply(actor,context,{kind:'link',id:a,identityId:a,organisationId:b,applicationId:'field',localUserId:'u',localAccountId:'acc',verifiedAt:'2026-01-01T00:00:00.000Z'}),/unverified application/);assert.ok(!calls.includes('write'));});
test('verified link can be persisted',async()=>{const {svc,calls}=harness();await svc.apply(actor,context,{kind:'link',id:a,identityId:a,organisationId:b,applicationId:'desk',localUserId:'u',localAccountId:'acc',verifiedAt:'2026-01-01T00:00:00.000Z'});assert.equal(calls.at(-1),'write');});
test('suspend, demote and revoke run without a live Logto membership check',async()=>{const {svc,calls}=harness({member:false});assert.equal(await svc.apply(actor,context,{kind:'membership_update',id:a,organisationId:b,expectedRevision:1,state:'suspended'}),'created');assert.ok(!calls.includes('membership'));assert.equal(calls.at(-1),'write');});
test('update commands still require policy authorisation',async()=>{const {svc,calls}=harness({allowed:false});await assert.rejects(svc.apply(actor,context,{kind:'link_revoke',id:a,organisationId:b,expectedRevision:1}),/forbidden/);assert.deepEqual(calls,['authorize']);});
