import {assertMigrationReceipt,CANONICAL_MIGRATION_ID} from './migration-receipt-policy.mjs';
import {fail} from './errors.mjs';
export async function verifyCanonicalMigrationReceipt(pool,{expectedId=CANONICAL_MIGRATION_ID,expectedHash}={}){
 if(typeof pool?.connect!=='function')fail('invalid_schema_pool');
 const c=await pool.connect();let active=false;
 try{
  await c.query('BEGIN TRANSACTION READ ONLY');active=true;
  await c.query('SET LOCAL ROLE titan_config_reader');
  await c.query("SET LOCAL statement_timeout = '5000ms'");
  const result=await c.query('SELECT migration_id,checksum_sha256 FROM titan.schema_migrations WHERE migration_id=$1',[expectedId]);
  const verified=assertMigrationReceipt({expectedId,expectedHash,rows:result.rows});
  await c.query('COMMIT');active=false;return verified;
 }catch(e){if(active)try{await c.query('ROLLBACK')}catch{}throw e}
 finally{c.release()}
}
