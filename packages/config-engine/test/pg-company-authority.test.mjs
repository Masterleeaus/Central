import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgCompanyGrantAuthority} from '../src/pg-company-authority.mjs';
test('real canonical scope uses restricted role and bound SQL',async()=>{
 let queries=[],released=false;
 const pool={connect:async()=>({query:async(q,args)=>{queries.push([q,args]);return q.includes('AS allowed')?{rows:[{allowed:true}]}:{rows:[]}},release(){released=true}})};
 const result=await createPgCompanyGrantAuthority({pool})({operatorSubject:'operator_a',companyId:'550e8400-e29b-41d4-a716-446655440000',product:'central',operation:'create'});
 assert.equal(result,true);assert.ok(released);
 assert.ok(queries.some(q=>q[0]==='SET LOCAL ROLE titan_config_company_authority_reader'));
 assert.deepEqual(queries.find(q=>q[1]?.length===4)[1].slice(0,3),['550e8400-e29b-41d4-a716-446655440000','operator_a','central']);
});
