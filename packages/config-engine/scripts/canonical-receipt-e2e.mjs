import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {verifyCanonicalMigrationReceipt} from '../src/pg-migration-receipt.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const {Pool}=require('pg');
const uri=new URL(process.env.CONFIG_TEST_DATABASE_URL);
uri.username='titan_config_api_login';uri.password='ci-config-api-only';
const pool=new Pool({connectionString:uri.href,max:2});
const expectedHash=process.env.TITAN_CONFIG_CANONICAL_MIGRATION_SHA256;
try{
 assert.equal((await verifyCanonicalMigrationReceipt(pool,{expectedHash})).checksum,expectedHash);
 await assert.rejects(verifyCanonicalMigrationReceipt(pool,{expectedHash:'0'.repeat(64)}));
 await assert.rejects(verifyCanonicalMigrationReceipt(pool,{expectedHash:'bad'}));
 console.log('restricted PostgreSQL login verified canonical migration SHA-256 receipt');
}finally{await pool.end()}
