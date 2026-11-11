import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgCompanyGrantAuthority} from '../src/pg-company-authority.mjs';
test('company authority refuses unmatched operator membership',async()=>{
 const pool={connect:async()=>({query:async q=>q.includes('AS allowed')?{rows:[{allowed:false}]}:{rows:[]},release(){}})};
 assert.equal(await createPgCompanyGrantAuthority({pool})({operatorSubject:'operator_b',companyId:'550e8400-e29b-41d4-a716-446655440000',product:'central',operation:'transition'}),false);
});
