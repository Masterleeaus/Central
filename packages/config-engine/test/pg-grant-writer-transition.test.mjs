import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantWriter} from '../src/pg-grant-writer.mjs';
test('revision CAS advances and revokes grant atomically',async()=>{
 let values;
 const c={query:async(q,args)=>{if(q.includes('SET state=')){values=args;return{rows:[{id:5,revision:2}]}}return{rows:[]}},release(){}};
 const writer=createPgGrantWriter({pool:{connect:async()=>c}});
 assert.deepEqual(await writer.transition({...{clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'},state:'revoked',expectedRevision:1}),{id:'5',revision:2});
 assert.equal(values[4],1);assert.equal(values[5],'revoked');
});
