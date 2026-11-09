import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfigStartup} from '../src/config-startup-guard.mjs';
test('an approval flag alone cannot bypass migration receipt verification',()=>{
 assert.throws(()=>assertConfigStartup({TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_MIGRATION_APPROVED:'true'}),/receipt/);
});
