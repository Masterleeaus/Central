import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralProductReader} from '../src/central-product-reader.mjs';

const ID='00000000-0000-4000-8000-000000000001';
const activeGrant=app=>({id:'grant',organisation_id:ID,application_id:app,state:'active',features:['session:open'],expires_at:null,revision:1});
const activeLink=app=>({id:'link',identity_id:'identity-1',organisation_id:ID,application_id:app,local_user_id:'user-1',local_account_id:'account-1',state:'verified',verified_at:'2026-01-01T00:00:00Z',revision:1});
function setup({membership='active',grant='active',links=true,fail=false}={}){
  const calls=[];
  const client={
    async query(sql,args){
      calls.push({sql,args});
      if(fail && sql.startsWith('SELECT'))throw Error('database unavailable');
      if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity-1',logto_subject:'subject-1',state:'active'}]};
      if(sql.includes('FROM titan.organisations'))return {rows:[{id:ID,logto_organisation_id:'org-external',state:'active'}]};
      if(sql.includes('FROM titan.memberships'))return {rows:[{id:'membership',identity_id:'identity-1',organisation_id:ID,role:'owner',state:membership,expires_at:null,revision:1}]};
      if(sql.includes('FROM titan.entitlements'))return {rows:grant==='active'?[activeGrant(args[1])]:[]};
      if(sql.includes('FROM titan.local_account_links'))return {rows:links?[activeLink(args[2])]:[]};
      return {rows:[]};
    },
    release(){calls.push({sql:'RELEASE'});}
  };
  const pool={async connect(){return client;}};
  const reader=createCentralProductReader({pool,getCompanyName:async()=> 'Example Co'});
  return {reader,calls};
}
test('trusted snapshot authorises all three mapped products',async()=>{
  const {reader,calls}=setup();
  const result=await reader({identityId:'subject-1',companyId:ID});
  assert.equal(result.authorised,true);
  assert.deepEqual(result.products,[{id:'sorted',status:'allowed'},{id:'supercharged',status:'allowed'},{id:'lms',status:'allowed'}]);
  const apps=calls.filter(c=>c.sql.includes('FROM titan.entitlements')).map(c=>c.args[1]);
  assert.deepEqual(apps,['field','desk','academy']);
  assert.equal(calls.filter(c=>c.sql==='SET LOCAL ROLE titan_trusted_reader').length,1);
  assert.deepEqual(calls.find(c=>c.sql.includes('set_config'))?.args,[ID]);
  assert.equal(calls.filter(c=>c.sql==='COMMIT').length,1);
  assert.equal(calls.at(-1).sql,'RELEASE');
});
test('revoked membership denies all products before entitlement lookups',async()=>{
  const {reader,calls}=setup({membership:'revoked'});
  assert.deepEqual(await reader({identityId:'subject-1',companyId:ID}),{authorised:false});
  assert.equal(calls.filter(c=>c.sql.includes('FROM titan.entitlements')).length,0);
});
test('missing entitlement is denied, never available',async()=>{
  const {reader}=setup({grant:'revoked'});
  const result=await reader({identityId:'subject-1',companyId:ID});
  assert.equal(result.authorised,true);
  assert.ok(result.products.every(p=>p.status==='denied'));
});
test('missing product account links remain unavailable',async()=>{
  const {reader}=setup({links:false});
  const result=await reader({identityId:'subject-1',companyId:ID});
  assert.ok(result.products.every(p=>p.status==='unavailable'));
});
test('invalid company scope fails before acquiring a connection',async()=>{
  const {reader,calls}=setup();
  assert.deepEqual(await reader({identityId:'subject-1',companyId:'evil'}),{authorised:false});
  assert.equal(calls.length,0);
});
test('database errors roll back, release and do not grant access',async()=>{
  const {reader,calls}=setup({fail:true});
  await assert.rejects(reader({identityId:'subject-1',companyId:ID}),/database unavailable/);
  assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
  assert.equal(calls.at(-1).sql,'RELEASE');
});
test('untrusted company name response fails closed',async()=>{
  const {reader,calls}=setup();
  const badReader=createCentralProductReader({pool:{connect:async()=>({
    query:async(sql,args)=>{
      if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity-1',logto_subject:'subject-1',state:'active'}]};
      if(sql.includes('FROM titan.organisations'))return {rows:[{id:ID,logto_organisation_id:'org-ext',state:'active'}]};
      if(sql.includes('FROM titan.memberships'))return {rows:[{id:'member',identity_id:'identity-1',organisation_id:ID,role:'owner',state:'active',expires_at:null,revision:1}]};
      return {rows:[]};
    },release(){}
  })},getCompanyName:async()=>''});
  assert.deepEqual(await badReader({identityId:'subject-1',companyId:ID}),{authorised:false});
  assert.equal(calls.length,0);
});
