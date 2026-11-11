/** Atomically consume one signed product account-control proof nonce.
 * Uses only a narrowly granted SECURITY DEFINER function in PostgreSQL.
 * A proof verifier MUST first check its signature, audience, exact command
 * binding, timestamp and independently pinned product key.
 */
import {createHash} from 'node:crypto';
const APPS=new Set(['field','desk','academy']);
const NONCE=/^[A-Za-z0-9_-]{32,128}$/;
const TIMESTAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
export function createPostgresLinkNonceClaimer({pool,clock=()=>Date.now()}={}){
 if(typeof pool?.connect!=='function'||typeof clock!=='function')
  throw TypeError('trusted database nonce store required');
 return async(applicationId,nonce,expiresAt)=>{
  if(!APPS.has(applicationId)||!NONCE.test(nonce??'')||
    typeof expiresAt!=='string'||!TIMESTAMP.test(expiresAt)||
    !Number.isFinite(Date.parse(expiresAt))||
    new Date(expiresAt).toISOString()!==expiresAt||
    Date.parse(expiresAt)<=clock()||
    Date.parse(expiresAt)>clock()+120_000)return false;
  const digest=createHash('sha256').update('titan:product-link-nonce:v1\n'+applicationId+'\n'+nonce).digest('hex');
  const client=await pool.connect();let started=false;
  try{
   await client.query('BEGIN');started=true;
   await client.query('SET LOCAL ROLE titan_product_link_nonce');
   await client.query("SET LOCAL statement_timeout = '5000ms'");
   const result=await client.query(
    'SELECT titan.claim_product_link_proof_nonce($1,$2::char(64),$3::timestamptz) AS claimed',
    [applicationId,digest,expiresAt]);
   if(result.rows?.length!==1||typeof result.rows[0].claimed!=='boolean')
    throw Error('nonce claim contract unavailable');
   await client.query('COMMIT');started=false;
   return result.rows[0].claimed;
  }catch{
   if(started)try{await client.query('ROLLBACK');}catch{}
   return false;
  }finally{client.release?.();}
 };
}
