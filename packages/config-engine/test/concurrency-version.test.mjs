import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
test('stale revision rejected before audit insert',async()=>{
 let audit=0;const client={query:async sql=>{
  if(sql.includes('FOR UPDATE'))return{rows:[{revision:3}]};
  if(sql.includes('INSERT INTO titan_config.audit'))audit++;
  return{rows:[]}},release(){}};
 const store=createPgConfigStore({pool:{connect:async()=>client}});
 await assert.rejects(store.commitOverride({key:'flag',expectedRevision:0,
 override:{product:'central',environment:'staging',target:{},revision:1,value:true,percentage:100,expiresAt:null},
 audit:{actorId:'ops',reason:'reject stale config'}}));
 assert.equal(audit,0);
});
