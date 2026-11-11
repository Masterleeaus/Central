import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAuthoritativeGrant} from '../src/config-client-context.mjs';
const id='550e8400-e29b-41d4-a716-446655440000';
test('grants must be active and exact product/environment',()=>{
 const grant={active:true,product:'central',environment:'staging',companyId:id,cohorts:['beta','beta']};
 assert.deepEqual(assertAuthoritativeGrant(grant,'central','staging').cohorts,['beta']);
 assert.throws(()=>assertAuthoritativeGrant(grant,'sorted','staging'));
 assert.throws(()=>assertAuthoritativeGrant({...grant,active:false},'central','staging'));
});
