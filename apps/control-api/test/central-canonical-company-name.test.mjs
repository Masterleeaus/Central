import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalCompanyNameProvider} from '../src/central-canonical-company-name.mjs';

const LEGACY='00000000-0000-4000-8000-000000000001';
const CANONICAL='00000000-0000-4000-8000-000000000011';
function fixture({resolved=CANONICAL,names=[{name:'Acme & Co'}],fail=false}={}){
  const calls=[];let released=0;
  const pool={async connect(){return{
    async query(sql,args){
      calls.push({sql,args});
      if(fail&&sql.includes('resolve_verified'))throw Error('database offline');
      if(sql.includes('resolve_verified_central_company'))return {rows:[{company_id:resolved}]};
      if(sql.includes('FROM titan.companies'))return {rows:names};
      return {rows:[]};
    },
    release(){released++}
  }}};
  return {getName:createCanonicalCompanyNameProvider({pool}),calls,get released(){return released}};
}
const input={companyId:LEGACY,logtoOrganisationId:'logto-legacy-1'};
test('resolves explicit approved mapping before scoped canonical company name read',async()=>{
  const f=fixture();
  assert.equal(await f.getName(input),'Acme & Co');
  assert.equal(f.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(f.calls.some(c=>c.sql==='SET LOCAL ROLE titan_shared_company_reader'));
  const lookup=f.calls.find(c=>c.sql.includes('resolve_verified_central_company'));
  assert.deepEqual(lookup.args,[LEGACY,'logto-legacy-1']);
  assert.deepEqual(f.calls.find(c=>c.sql.includes("set_config('titan.company_id'"))?.args,[CANONICAL]);
  assert.deepEqual(f.calls.find(c=>c.sql.includes('FROM titan.companies'))?.args,[CANONICAL]);
  assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(f.released,1);
});
test('unverified, missing or inactive canonical mappings fail closed',async()=>{
  for(const cfg of [{resolved:null},{resolved:'not-uuid'},{names:[]},{names:[{name:''}]}]){
    const f=fixture(cfg);await assert.rejects(f.getName(input));
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.released,1);
  }
});
test('untrusted legacy IDs and Logto identifiers do not access database',async()=>{
  const f=fixture();
  for(const invalid of [
    {...input,companyId:'malformed'},
    {...input,logtoOrganisationId:''},
    {...input,logtoOrganisationId:'evil\nheader'}
  ])await assert.rejects(f.getName(invalid),TypeError);
  assert.equal(f.calls.length,0);
});
test('database errors roll back and release without leaking a guessed name',async()=>{
  const f=fixture({fail:true});
  await assert.rejects(f.getName(input),/database offline/);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.released,1);
});
