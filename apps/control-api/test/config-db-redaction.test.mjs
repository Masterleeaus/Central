import test from 'node:test';
import assert from 'node:assert/strict';
import {safeConfigDatabaseError} from '../src/config-db-redaction.mjs';
test('errors never include secret strings',()=>{
 const e=safeConfigDatabaseError({code:'28P01',message:'credential=secret'});
 assert.equal(e.code,'28P01');assert.ok(!JSON.stringify(e).includes('secret'));
});
