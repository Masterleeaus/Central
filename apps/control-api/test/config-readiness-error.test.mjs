import test from 'node:test';
import assert from 'node:assert/strict';
import {safeConfigReadinessFailure} from '../src/config-readiness-error.mjs';
test('redacts credentials and database error messages',()=>{
 const output=safeConfigReadinessFailure({code:'28P01',message:'postgresql://admin:pass@database'});
 assert.equal(output.code,'config_readiness_failed');assert.ok(!JSON.stringify(output).includes('pass'));
});
