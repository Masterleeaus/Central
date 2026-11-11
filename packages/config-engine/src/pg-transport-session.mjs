import {fail} from './errors.mjs';
export async function verifyPgTlsSession(pool){
 if(typeof pool?.connect!=='function')fail('invalid_tls_session_pool');
 const client=await pool.connect();
 try{
  const result=await client.query('SELECT ssl,version,cipher FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()');
  const row=result.rows?.length===1?result.rows[0]:null;
  if(row?.ssl!==true||!row.version||!row.cipher)fail('unencrypted_database_session');
  return Object.freeze({tls:true,protocol:row.version,cipher:row.cipher});
 }finally{client.release()}
}
