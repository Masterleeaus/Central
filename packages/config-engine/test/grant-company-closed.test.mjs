import test from 'node:test';
import assert from 'node:assert/strict';
import {requireOneActiveGrant} from '../src/grant-result.mjs';
test('closed companies are denied even with active grant',()=>{
 assert.throws(()=>requireOneActiveGrant([{company_id:'550e8400-e29b-41d4-a716-446655440000',state:'active',company_status:'closed'}]));
});
