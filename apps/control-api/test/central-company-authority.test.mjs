import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralCompanyAuthority} from '../src/central-company-authority.mjs';
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const ISSUER='https://issuer.example/';
function setup({companies=[{organisation_id:A,logto_organisation_id:'logto-A'}],membership='active',identity='active',organisation='active',entitlement='active',expiry=null,fail=false}={}){
  const calls=[];let released=0;
  const client={
    async query(sql,args){
      calls.push({sql,args});
      if(fail&&sql.includes('central_eligible_companies'))throw Error('database disconnected');
      if(sql.includes('central_eligible_companies'))return {rows:companies};
      if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity-1',logto_subject:'subject-1',state:identity}]};
      if(sql.includes('FROM titan.organisations'))return {rows:[{id:A,logto_organisation_id:'logto-A',state:organisation}]};
      if(sql.includes('FROM titan.memberships'))return {rows:[{id:'membership-1',identity_id:'identity-1',organisation_id:A,role:'owner',state:membership,expires_at:expiry,revision:1}]};
      if(sql.includes('FROM titan.entitlements'))return {rows:entitlement?[{id:'entitlement-1',organisation_id:A,application_id:args[1],state:entitlement,features:[],expires_at:null,revision:1}]:[]};
      return {rows:[]};
    },
    release(){released++}
  };
  const pool={async connect(){return client;}};
  const names=[];
  const authority=createCentralCompanyAuthority({pool,issuer:ISSUER,async getCompanyName(company){names.push(company);return 'Alpha & Co';}});
  return {authority,calls,names,get released(){return released}};
}
test('discovery returns authoritative company IDs using dedicated restricted role',async()=>{
  const ctx=setup();
  assert.deepEqual(await ctx.authority.listEligibleCompanies({issuer:ISSUER,subject:'subject-1'}),[{companyId:A,authorised:true}]);
  assert.equal(ctx.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(ctx.calls.some(c=>c.sql==='SET LOCAL ROLE titan_central_discovery'));
  assert.deepEqual(ctx.calls.find(c=>c.sql.includes('central_eligible_companies'))?.args,['subject-1']);
  assert.equal(ctx.calls.at(-1).sql,'COMMIT');
  assert.equal(ctx.released,1);
});
test('multi-company discovery derives names from a trusted provider only',async()=>{
  const ctx=setup({companies:[{organisation_id:A,logto_organisation_id:'logto-A'},{organisation_id:B,logto_organisation_id:'logto-B'}]});
  const list=await ctx.authority.listOrganisations({issuer:ISSUER,subject:'subject-1'});
  assert.deepEqual(list,[{id:A,name:'Alpha & Co'},{id:B,name:'Alpha & Co'}]);
  assert.equal(ctx.names.length,2);
});
test('issuer mismatch or invalid subject fails before database access',async()=>{
  const ctx=setup();
  assert.deepEqual(await ctx.authority.listEligibleCompanies({issuer:'https://attacker.example/',subject:'subject-1'}),[]);
  assert.deepEqual(await ctx.authority.listEligibleCompanies({issuer:ISSUER,subject:'bad\nsubject'}),[]);
  assert.equal(ctx.calls.length,0);
});
test('duplicate or malformed discovery results fail closed and roll back',async()=>{
  for(const companies of [
    [{organisation_id:A,logto_organisation_id:'x'},{organisation_id:A,logto_organisation_id:'y'}],
    [{organisation_id:'foreign',logto_organisation_id:'x'}],
    Array.from({length:129},(_,i)=>({organisation_id:A,logto_organisation_id:String(i)}))
  ]){
    const ctx=setup({companies});
    await assert.rejects(ctx.authority.listEligibleCompanies({issuer:ISSUER,subject:'subject-1'}));
    assert.equal(ctx.calls.at(-1).sql,'ROLLBACK');assert.equal(ctx.released,1);
  }
});
test('database errors cause rollback and release, not guessed membership',async()=>{
  const ctx=setup({fail:true});
  await assert.rejects(ctx.authority.listEligibleCompanies({issuer:ISSUER,subject:'subject-1'}),/database disconnected/);
  assert.equal(ctx.calls.at(-1).sql,'ROLLBACK');assert.equal(ctx.released,1);
});
test('selected company is checked in a separate RLS scoped snapshot',async()=>{
  const ctx=setup();
  assert.equal(await ctx.authority.recheckCompany({issuer:ISSUER,subject:'subject-1',companyId:A}),true);
  assert.ok(ctx.calls.some(c=>c.sql==='SET LOCAL ROLE titan_trusted_reader'));
  assert.deepEqual(ctx.calls.find(c=>c.sql.includes('set_config'))?.args,[A]);
  assert.ok(ctx.calls.some(c=>c.sql==='COMMIT'));
});
test('revocation, expired membership, blocked identity and disabled product entitlements deny',async()=>{
  const cases=[{membership:'revoked'},{expiry:new Date('2020-01-01T00:00:00Z')},{identity:'blocked'},{organisation:'suspended'},{entitlement:'revoked'}];
  for(const config of cases){
    const {authority}=setup(config);
    assert.equal(await authority.recheckCompany({issuer:ISSUER,subject:'subject-1',companyId:A}),false);
  }
});
test('invalid company or wrong issuer cannot acquire a database connection',async()=>{
  const ctx=setup();
  assert.equal(await ctx.authority.recheckCompany({issuer:ISSUER,subject:'subject-1',companyId:'wrong'}),false);
  assert.equal(await ctx.authority.recheckCompany({issuer:'https://foreign.example/',subject:'subject-1',companyId:A}),false);
  assert.equal(ctx.calls.length,0);
});
