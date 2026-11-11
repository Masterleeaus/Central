import test from 'node:test';
import assert from 'node:assert/strict';
import {restrictTenantOverrides} from '../src/tenant-filter.mjs';
const a='550e8400-e29b-41d4-a716-446655440000',b='550e8400-e29b-41d4-a716-446655440001';
test('filters another company',()=>assert.equal(restrictTenantOverrides([{target:{companyId:a}},{target:{companyId:b}},{target:{cohort:'beta'}}],{companyId:a}).length,2));
