import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedContext} from '../src/verified-context.mjs';
const data={product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000'};
test('rejects untrusted identity and cross-product scope',()=>{
 assert.throws(()=>verifiedContext({...data,principal:{authenticated:true,kind:'user',products:['central']}}));
 assert.throws(()=>verifiedContext({...data,principal:{authenticated:true,kind:'service',products:['sorted']}}));
 assert.deepEqual(verifiedContext({...data,principal:{authenticated:true,kind:'service',products:['central']},cohorts:['beta','beta']}).cohorts,['beta']);
});
