import test from 'node:test';
import assert from 'node:assert/strict';
import {restrictTenantOverrides} from '../src/tenant-filter.mjs';
test('filters company B before evaluation for company A',()=>{
 const out=restrictTenantOverrides([{target:{companyId:'550e8400-e29b-41d4-a716-446655440000'}},{target:{companyId:'550e8400-e29b-41d4-a716-446655440001'}},{target:{}}],{companyId:'550e8400-e29b-41d4-a716-446655440000'});
 assert.equal(out.length,2);
});
