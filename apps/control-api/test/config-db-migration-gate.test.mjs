import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfigMigrationApproval} from '../src/config-db-migration-gate.mjs';
test('migration approval is explicit, not inferred from CI',()=>{
 assert.equal(assertConfigMigrationApproval({}),false);
 assert.throws(()=>assertConfigMigrationApproval({TITAN_CONFIG_ENABLED:'true'}));
 assert.equal(assertConfigMigrationApproval({TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_MIGRATION_APPROVED:'true'}),true);
});
