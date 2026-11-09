import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMigrationReceipt} from '../src/migration-receipt-policy.mjs';
test('exact migration ID and checksum required',()=>{
 const hash='a'.repeat(64),rows=[{migration_id:'0001_shared_company_core',checksum_sha256:hash}];
 assert.equal(assertMigrationReceipt({expectedHash:hash,rows}).checksum,hash);
 assert.throws(()=>assertMigrationReceipt({expectedHash:hash,rows:[]}));
 assert.throws(()=>assertMigrationReceipt({expectedHash:hash,rows:[...rows,...rows]}));
});
