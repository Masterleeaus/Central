import test from 'node:test';
import assert from 'node:assert/strict';
import {CANONICAL_MIGRATION_SHA,requirePinnedCanonicalMigration} from '../src/canonical-migration-pin.mjs';
test('canonical source must be exact immutable reviewed SHA',()=>{
 assert.equal(requirePinnedCanonicalMigration(CANONICAL_MIGRATION_SHA),CANONICAL_MIGRATION_SHA);
 assert.throws(()=>requirePinnedCanonicalMigration('main'));
 assert.throws(()=>requirePinnedCanonicalMigration('f'.repeat(40)));
});
