import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
test('definition and overrides share one repeatable read transaction',async()=>{
 const sql=[];let released=false;
 const c={query:async(q,params)=>{sql.push({q,params});return q.includes('FROM titan_config.definitions')?{rows:[{product:'central',key:'flag',owner:'ops',value_type:'boolean',default_value:false,allowed_values:null,description:''}]}:{rows:[]};},release(){released=true}};
 const store=createPgConfigStore({pool:{connect:async()=>c}});
 const id='550e8400-e29b-41d4-a716-446655440000';
 const result=await store.readSnapshot({key:'flag',product:'central',environment:'staging',companyId:id,cohorts:['beta']});
 assert.equal(result.definition.key,'flag');assert.equal(sql[0].q,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.deepEqual(sql.find(x=>x.params?.length===5).params,['central','flag','staging',id,['beta']]);
 assert.equal(sql.at(-1).q,'COMMIT');assert.equal(released,true);
});
