import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAuthoritativeGrant} from '../src/config-client-context.mjs';
test('grant requires exact product and environment',()=>{
 const g={active:true,product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[]};
 assert.equal(assertAuthoritativeGrant(g,'central','stage').companyId,g.companyId);
 assert.throws(()=>assertAuthoritativeGrant(g,'sorted','stage'));
});
