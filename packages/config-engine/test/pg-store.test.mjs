import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
const row={product:'central',key:'flag',owner:'ops',value_type:'boolean',default_value:false,allowed_values:null,description:''};
const override={product:'central',environment:'staging',target:{},value:true,percentage:100,expiresAt:null,revision:1};
test('atomic write takes scope lock and writes revision and audit',async()=>{
 const sql=[];let released=false;
 const c={query:async(q)=>{sql.push(q);if(q.includes('FOR UPDATE'))return {rows:[{revision:0}]};
 if(q.includes('FROM titan_config.definitions'))return {rows:[row]};return {rows:[]};},release:()=>released=true};
 const store=createPgConfigStore({pool:{connect:async()=>c},correlationId:()=> 'trace'});
 const r=await store.commitOverride({key:'flag',override,expectedRevision:0,audit:{actorId:'ops',reason:'safe staged rollout'}});
 assert.equal(r.revision,1);assert.ok(released);assert.ok(sql.some(q=>q.includes('titan_config.audit')));assert.equal(sql.at(-1),'COMMIT');
});
test('revision conflict rolls back',async()=>{
 const sql=[];const c={query:async(q)=>{sql.push(q);return q.includes('FOR UPDATE')?{rows:[{revision:2}]}:{rows:[]};},release(){}};
 const store=createPgConfigStore({pool:{connect:async()=>c}});
 await assert.rejects(store.commitOverride({key:'flag',override,expectedRevision:0,audit:{actorId:'ops',reason:'safe staged rollout'}}));
 assert.equal(sql.at(-1),'ROLLBACK');
});
