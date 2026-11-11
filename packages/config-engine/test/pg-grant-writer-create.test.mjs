import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantWriter} from '../src/pg-grant-writer.mjs';
test('inserts only via role-scoped audited transaction',async()=>{
 const calls=[];let released=0;
 const c={query:async(q,p)=>{calls.push([q,p]);return q.includes('RETURNING id')?{rows:[{id:17,revision:1}]}:{rows:[]}},release(){released++}};
 const write=createPgGrantWriter({pool:{connect:async()=>c}});
 assert.deepEqual(await write.create({clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'}),{id:'17',revision:1});
 assert.ok(calls.some(x=>x[0]==='SET LOCAL ROLE titan_config_grant_writer'));
 assert.deepEqual(calls.find(x=>x[0].startsWith('SELECT set_config'))[1],['titan_config.grant_actor','operator']);
 assert.equal(calls.at(-1)[0],'COMMIT');assert.equal(released,1);
});
