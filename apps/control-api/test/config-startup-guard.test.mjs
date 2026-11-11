import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfigStartup} from '../src/config-startup-guard.mjs';
test('incomplete enabled config fails closed',()=>{
 assert.equal(assertConfigStartup({}),false);
 assert.throws(()=>assertConfigStartup({TITAN_CONFIG_ENABLED:'true'}));
});
