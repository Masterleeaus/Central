import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalCompanySource,ensureSeparateCanonicalDatabase} from '../src/central-shared-bootstrap.mjs';

const legacy='postgresql://test@localhost:5432/titan_central';
const shared='postgresql://test@localhost:5432/titan_shared';
test('staging bootstrap rejects alias URL targeting the legacy database',()=>{
  assert.throws(()=>ensureSeparateCanonicalDatabase(legacy,'postgres://other@elsewhere:5432/titan_central'),/distinct database name/);
  assert.throws(()=>ensureSeparateCanonicalDatabase(legacy,'https://elsewhere/shared'),TypeError);
  assert.equal(ensureSeparateCanonicalDatabase(legacy,shared),true);
});
function fixture({rows=[{companies:'titan.companies',links:'titan.central_legacy_company_links',resolver:'titan.resolve_verified_central_company(uuid,text)'}]}={}){
  const created=[],ended=[],queries=[];
  class Pool{
    constructor(settings){created.push(settings)}
    async connect(){return {async query(sql){queries.push(sql);return {rows}},release(){queries.push('RELEASE')}}}
    async end(){ended.push(true)}
  }
  return {Pool,created,ended,queries};
}
test('trusted canonical name pool checks schema before returning resolver',async()=>{
  const f=fixture();
  const result=await createCanonicalCompanySource({legacyUrl:legacy,sharedUrl:shared,Pool:f.Pool});
  assert.equal(f.created.length,1);
  assert.equal(f.created[0].connectionString,shared);
  assert.equal(typeof result.getCompanyName,'function');
  assert.equal(f.queries.length,2);
  assert.equal(f.ended.length,0);
  await result.sharedPool.end();
  assert.equal(f.ended.length,1);
});
test('failed canonical schema preflight closes shared pool and fails startup',async()=>{
  const f=fixture({rows:[{companies:null,links:null,resolver:null}]});
  await assert.rejects(createCanonicalCompanySource({legacyUrl:legacy,sharedUrl:shared,Pool:f.Pool}),/not installed/);
  assert.equal(f.ended.length,1);
});
