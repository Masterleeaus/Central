import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedContext} from '../src/verified-context.mjs';
test('service context cannot claim ungranted product',()=>{
 const principal={authenticated:true,kind:'service',products:['central']};
 const companyId='550e8400-e29b-41d4-a716-446655440000';
 assert.equal(verifiedContext({principal,product:'central',environment:'staging',companyId}).companyId,companyId);
 assert.throws(()=>verifiedContext({principal,product:'sorted',environment:'staging',companyId}));
});
