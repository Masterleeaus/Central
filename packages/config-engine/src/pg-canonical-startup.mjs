import {verifyCanonicalSchema} from './pg-canonical-catalog.mjs';
import {fail} from './errors.mjs';
export async function verifyCanonicalDbAtStartup(pool){
 if(typeof pool?.connect!=='function')fail('invalid_schema_pool');
 const client=await pool.connect();let begun=false;
 try{
  await client.query('BEGIN TRANSACTION READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  const result=await verifyCanonicalSchema(client);
  await client.query('COMMIT');begun=false;return result;
 }catch(error){if(begun)try{await client.query('ROLLBACK')}catch{}throw error}
 finally{client.release()}
}
