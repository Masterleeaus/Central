import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalDbAtStartup} from '../src/pg-canonical-startup.mjs';
const catalog={relations:["titan.companies","titan.identities","titan.company_memberships","titan.application_entitlements","titan.application_company_links","titan.application_user_links","titan.schema_migrations"],foreignKeys:[{"table":"titan.company_memberships","column":"company_id","target":"titan.companies"},{"table":"titan.company_memberships","column":"identity_id","target":"titan.identities"},{"table":"titan.application_entitlements","column":"company_id","target":"titan.companies"},{"table":"titan.application_company_links","column":"company_id","target":"titan.companies"},{"table":"titan.application_user_links","column":"company_id","target":"titan.companies"},{"table":"titan.application_user_links","column":"identity_id","target":"titan.identities"},{"table":"titan_config.service_company_grants","column":"company_id","target":"titan.companies"}]};let released=false,statements=[];
test('complete canonical catalog commits read-only verification',async()=>{
 const client={query:async sql=>{
  statements.push(sql);
  if(sql.includes('FROM pg_catalog.pg_class c'))return{rows:catalog.relations.map(relation=>({relation}))};
  if(sql.includes('FROM pg_catalog.pg_constraint k'))return{rows:catalog.foreignKeys.map(x=>({table_name:x.table,column_name:x.column,target_name:x.target}))};
  return{rows:[]};
 },release(){released=true}};
 const out=await verifyCanonicalDbAtStartup({connect:async()=>client});
 assert.equal(out.relations.length,catalog.relations.length);
 assert.equal(statements.at(-1),'COMMIT');assert.ok(released);
});
