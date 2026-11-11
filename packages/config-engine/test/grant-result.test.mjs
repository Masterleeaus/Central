import test from 'node:test';
import assert from 'node:assert/strict';
import {requireOneActiveGrant} from '../src/grant-result.mjs';
test('grant requires a unique active company',()=>{
 const r={company_id:'550e8400-e29b-41d4-a716-446655440000',state:'active',company_status:'active'};
 assert.equal(requireOneActiveGrant([r]),r);
 for(const rows of [[],[r,r],[{...r,state:'revoked'}],[{...r,company_status:'suspended'}]])assert.throws(()=>requireOneActiveGrant(rows));
});
