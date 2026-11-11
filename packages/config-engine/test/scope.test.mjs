import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeOf} from '../src/scope.mjs';
test('canonical scope',()=>{assert.deepEqual(scopeOf({}),{kind:'environment',scope:'*'});
 assert.deepEqual(scopeOf({cohort:'beta'}),{kind:'cohort',scope:'beta'});
 assert.throws(()=>scopeOf({cohort:'beta',companyId:'550e8400-e29b-41d4-a716-446655440000'}));});
