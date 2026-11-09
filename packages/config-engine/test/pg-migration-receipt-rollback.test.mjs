import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalMigrationReceipt} from '../src/pg-migration-receipt.mjs';
test('missing receipt rolls back and releases SQL connection',async()=>{
 const commands=[];let released=false;
 const pool={connect:async()=>({query:async q=>{commands.push(q);return{rows:[]}},release(){released=true}})};
 await assert.rejects(verifyCanonicalMigrationReceipt(pool,{expectedHash:'e'.repeat(64)}));
 assert.equal(commands.at(-1),'ROLLBACK');assert.ok(released);
});
