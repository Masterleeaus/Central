import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalMigrationReceipt} from '../src/pg-migration-receipt.mjs';
test('receipt uses restricted role, parameterised SQL and read-only commit',async()=>{
 const hash='d'.repeat(64),sql=[];let released=false;
 const pool={connect:async()=>({query:async(q,args)=>{sql.push([q,args]);return q.startsWith('SELECT migration_id')?{rows:[{migration_id:'0001_shared_company_core',checksum_sha256:hash}]}:{rows:[]}},release(){released=true}})};
 assert.equal((await verifyCanonicalMigrationReceipt(pool,{expectedHash:hash})).checksum,hash);
 assert.ok(sql.some(x=>x[0]==='SET LOCAL ROLE titan_config_reader'));
 assert.deepEqual(sql.find(x=>x[1])[1],['0001_shared_company_core']);
 assert.equal(sql.at(-1)[0],'COMMIT');assert.ok(released);
});
