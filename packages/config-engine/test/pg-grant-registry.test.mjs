import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantRegistry} from '../src/pg-grant-registry.mjs';
test('restricted grant read binds verified client identity and releases connection',async()=>{
 let calls=[],released=0;
 const client={query:async(q,args)=>{calls.push([q,args]);return q.includes('SELECT product,environment')?{rows:[{product:'central',environment:'stage',company_id:'550e8400-e29b-41d4-a716-446655440000',cohorts:['beta']}]}:{rows:[]}},release:()=>released++};
 const lookup=createPgGrantRegistry({pool:{connect:async()=>client}});
 const result=await lookup({clientId:'machine',application:'central',environment:'stage'});
 assert.equal(result.companyId,'550e8400-e29b-41d4-a716-446655440000');
 assert.deepEqual(calls.find(c=>c[1]?.length===4)[1].slice(0,3),['machine','central','stage']);
 assert.ok(calls.some(c=>c[0]==='SET LOCAL ROLE titan_config_grant_reader'));
 assert.equal(calls.at(-1)[0],'COMMIT');assert.equal(released,1);
});
