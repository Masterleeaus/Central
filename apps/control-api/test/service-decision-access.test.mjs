import test from 'node:test';import assert from 'node:assert/strict';
import {createSkilledDecisionAccess} from '../src/service-decision-access.mjs';
import {issuer,org,subject} from './service-decision-harness.mjs';
const row=sql=>{
 if(sql.startsWith('SELECT id, logto_organisation_id'))return {rows:[{id:org,logto_organisation_id:'logto-org-0001',state:'active'}]};
 if(sql.startsWith('SELECT id, logto_subject'))return {rows:[{id:'central-id-1',logto_subject:subject,state:'active'}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, role'))return {rows:[{id:'member-1',identity_id:'central-id-1',organisation_id:org,role:'learner',state:'active',expires_at:null,revision:1}]};
 if(sql.startsWith('SELECT id, organisation_id, application_id'))return {rows:[{id:'grant-1',organisation_id:org,application_id:'academy',state:'active',features:['session:open'],expires_at:null,revision:2}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, application_id'))return {rows:[{id:'link-1',identity_id:'central-id-1',organisation_id:org,application_id:'academy',local_user_id:'skilled-user-0001',local_account_id:'skilled-account-0001',state:'verified',verified_at:null,revision:3}]};
 return {rows:[]};
};
const pool=(query=row,calls=[])=>({async connect(){return {async query(sql,args){calls.push([sql,args]);return query(sql,args)},release(){calls.push(['RELEASE'])}}}});
test('evaluates membership grant and link in tenant-scoped read-only snapshot',async()=>{
 const calls=[];const get=createSkilledDecisionAccess({pool:pool(row,calls),issuer,audience:'academy-client'});
 const decision=await get({organisationId:org,subject});assert.equal(decision.allowed,true);
 assert.equal(decision.organisationId,'logto-org-0001');assert.equal(decision.linkRevision,3);
 assert.ok(calls.some(([sql])=>sql.includes('REPEATABLE READ READ ONLY')));
 assert.ok(calls.some(([sql])=>sql.includes('SET LOCAL ROLE titan_trusted_reader')));
 assert.ok(calls.some(([sql])=>sql==='COMMIT'));
 assert.equal(calls.at(-1)[0],'RELEASE');
});
test('revoked entitlement denies decision without credentials in response',async()=>{
 const get=createSkilledDecisionAccess({pool:pool(sql=>{
  const result=row(sql);if(sql.startsWith('SELECT id, organisation_id, application_id'))return {rows:[]};return result;
 }),issuer,audience:'academy-client'});
 assert.equal(await get({organisationId:org,subject}),null);
});
test('inactive organisation denies before local account lookup',async()=>{
 const get=createSkilledDecisionAccess({pool:pool(sql=>{
  if(sql.startsWith('SELECT id, logto_organisation_id'))return {rows:[{id:org,logto_organisation_id:'logto-org-0001',state:'suspended'}]};
  return row(sql);
 }),issuer,audience:'academy-client'});
 assert.equal(await get({organisationId:org,subject}),null);
});
