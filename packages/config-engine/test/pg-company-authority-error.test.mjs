import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgCompanyGrantAuthority} from '../src/pg-company-authority.mjs';
test('authority database errors roll back and release',async()=>{
 let q=[],released=false;
 const pool={connect:async()=>({query:async sql=>{q.push(sql);if(sql.includes('AS allowed'))throw Error('failure');return {rows:[]}},release(){released=true}})};
 await assert.rejects(createPgCompanyGrantAuthority({pool})({operatorSubject:'operator_a',companyId:'550e8400-e29b-41d4-a716-446655440000',product:'central',operation:'create'}));
 assert.equal(q.at(-1),'ROLLBACK');assert.ok(released);
});
