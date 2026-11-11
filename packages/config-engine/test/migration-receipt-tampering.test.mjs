import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMigrationReceipt} from '../src/migration-receipt-policy.mjs';
test('forged, malformed and wrong-version checksums rejected',()=>{
 const rows=[{migration_id:'0001_shared_company_core',checksum_sha256:'b'.repeat(64)}];
 assert.throws(()=>assertMigrationReceipt({expectedHash:'c'.repeat(64),rows}));
 assert.throws(()=>assertMigrationReceipt({expectedHash:'invalid',rows}));
 assert.throws(()=>assertMigrationReceipt({expectedId:'0002_fake',expectedHash:'b'.repeat(64),rows}));
});
