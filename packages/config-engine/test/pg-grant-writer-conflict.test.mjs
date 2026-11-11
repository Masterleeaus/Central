import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantWriter} from '../src/pg-grant-writer.mjs';
test('zero-row CAS result rolls back without silently granting access',async()=>{
 const calls=[];let released=0;
 const c={query:async(q)=>{calls.push(q);return{rows:[]}},release(){released++}};
 const writer=createPgGrantWriter({pool:{connect:async()=>c}});
 await assert.rejects(writer.transition({...{clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'},expectedRevision:1,state:'revoked'}));
 assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,1);
});
