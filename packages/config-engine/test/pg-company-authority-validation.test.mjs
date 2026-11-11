import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgCompanyGrantAuthority} from '../src/pg-company-authority.mjs';
test('invalid operators and products rejected before database connection',async()=>{
 let connections=0;
 const authorize=createPgCompanyGrantAuthority({pool:{connect:async()=>{connections++;throw Error('should not connect')}}});
 await assert.rejects(authorize({operatorSubject:'invalid actor',companyId:'550e8400-e29b-41d4-a716-446655440000',product:'central',operation:'create'}));
 await assert.rejects(authorize({operatorSubject:'operator_a',companyId:'550e8400-e29b-41d4-a716-446655440000',product:'bad',operation:'create'}));
 assert.equal(connections,0);
});
