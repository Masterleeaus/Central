import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopedPgConfigStore} from '../src/scoped-pg-store.mjs';
const id='550e8400-e29b-41d4-a716-446655440000';
test('read is restricted and parameterised inside one transaction',async()=>{
 const sql=[];let released=false;
 const c={query:async(q,args)=>{sql.push([q,args]);return q.includes('FROM titan_config.definitions')?{rows:[{key:'feature',product:'central',owner:'ops',value_type:'boolean',default_value:false,allowed_values:null,description:''}]}:{rows:[]};},release(){released=true}};
 const store=createScopedPgConfigStore({pool:{connect:async()=>c}});
 const result=await store.readSnapshot({key:'feature',product:'central',environment:'staging',companyId:id,cohorts:['beta']});
 assert.equal(result.definition.key,'feature');assert.equal(result.overrides.length,0);
 assert.ok(sql.some(q=>q[0]==='SET LOCAL ROLE titan_config_reader'));
 assert.deepEqual(sql.find(q=>q[1]?.length===5)[1],['central','feature','staging',id,['beta']]);
 assert.equal(sql.at(-1)[0],'COMMIT');assert.ok(released);
});
