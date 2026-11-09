/** Durable, one-use, app-scoped company selection states.
 * Verbatim identifiers from a product browser are never authoritative.
 * The issuer, OIDC subject and permitted company IDs are AEAD sealed with
 * application-specific additional authenticated data. The only lookup key
 * is a domain-separated SHA-256 digest of a cryptographically random state.
 */
import {createHash} from 'node:crypto';
import {createStateSealerFromEnv} from './oidc-state-crypto.mjs';
const APPS=new Set(['field','desk','academy']);
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const SUBJECT=/^[^\s\x00-\x1f\x7f]{1,256}$/u;
const digest=(app,state)=>createHash('sha256').update('titan:product-company-selection:v1\n'+app+'\n'+state).digest('hex');
const aad=(app,id,field)=>'product_company_selection|'+app+'|'+id+'|'+field;
function validIssuer(issuer){
 try{
  const u=new URL(issuer);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
   (u.href===issuer||(u.pathname==='/'&&u.origin===issuer));
 }catch{return false;}
}
async function transaction(pool,task){
 const client=await pool.connect();let started=false;
 try{
  await client.query('BEGIN');started=true;
  await client.query('SET LOCAL ROLE titan_product_selection');
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  const result=await task(client);
  await client.query('COMMIT');started=false;
  return result;
 }catch(error){
  if(started)try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release?.()}
}
export function createPostgresProductSelectionStore({pool,applicationId,
 sealer=createStateSealerFromEnv(),clock=()=>Date.now()}={}){
 if(!APPS.has(applicationId)||typeof pool?.connect!=='function'||
  typeof sealer?.seal!=='function'||typeof sealer?.open!=='function'||
  typeof clock!=='function')
  throw TypeError('trusted product selection storage required');
 return Object.freeze({
  async save(state,record){
   const now=clock();
   if(!TOKEN.test(state??'')||!validIssuer(record?.issuer)||
    !SUBJECT.test(record?.subject??'')||!HASH.test(record?.bindingHash??'')||
    !Array.isArray(record?.organisationIds)||record.organisationIds.length===0||
    record.organisationIds.length>128||!record.organisationIds.every(id=>typeof id==='string'&&UUID.test(id))||
    new Set(record.organisationIds).size!==record.organisationIds.length||
    !Number.isSafeInteger(now)||!Number.isSafeInteger(record.expiresAt)||
    record.expiresAt<=now||record.expiresAt>now+600000)
    throw TypeError('invalid product company selection state');
   const id=digest(applicationId,state);
   const values=[applicationId,id,record.bindingHash,
    sealer.seal(record.issuer,aad(applicationId,id,'issuer')),
    sealer.seal(record.subject,aad(applicationId,id,'subject')),
    sealer.seal(JSON.stringify(record.organisationIds),aad(applicationId,id,'companies')),
    record.expiresAt];
   return transaction(pool,async client=>{
    const result=await client.query(
     'INSERT INTO titan.product_company_selection_states(application_id,state_digest,binding_hash,sealed_issuer,sealed_subject,sealed_company_ids,expires_at) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision / 1000)) RETURNING state_digest',values);
    if(result.rows?.length!==1)throw Error('product selection state not recorded');
   });
  },
  async consume(state){
   if(!TOKEN.test(state??''))return null;
   const id=digest(applicationId,state);
   return transaction(pool,async client=>{
    const result=await client.query(
     'DELETE FROM titan.product_company_selection_states WHERE application_id=$1 AND state_digest=$2 AND expires_at>to_timestamp($3::double precision / 1000) RETURNING binding_hash,sealed_issuer,sealed_subject,sealed_company_ids,expires_at',
     [applicationId,id,clock()]);
    if(result.rows?.length!==1)return null;
    try{
     const row=result.rows[0];
     const issuer=sealer.open(row.sealed_issuer,aad(applicationId,id,'issuer'));
     const subject=sealer.open(row.sealed_subject,aad(applicationId,id,'subject'));
     const organisationIds=JSON.parse(sealer.open(row.sealed_company_ids,aad(applicationId,id,'companies')));
     if(!validIssuer(issuer)||!SUBJECT.test(subject)||!HASH.test(row.binding_hash)||
      !Array.isArray(organisationIds)||organisationIds.length===0||organisationIds.length>128||
      !organisationIds.every(company=>typeof company==='string'&&UUID.test(company))||
      new Set(organisationIds).size!==organisationIds.length)return null;
     const expiresAt=new Date(row.expires_at).getTime();
     if(!Number.isSafeInteger(expiresAt)||expiresAt<=clock())return null;
     return {issuer,subject,organisationIds,bindingHash:row.binding_hash,expiresAt};
    }catch{return null}
   });
  },
  async prune({limit=500}={}){
   if(!Number.isSafeInteger(limit)||limit<1||limit>5000)
    throw TypeError('invalid product selection prune limit');
   return transaction(pool,async client=>{
    const result=await client.query(
     'DELETE FROM titan.product_company_selection_states WHERE(application_id,state_digest) IN (SELECT application_id,state_digest FROM titan.product_company_selection_states WHERE application_id=$1 AND expires_at<=now() ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING state_digest',
     [applicationId,limit]);
    return result.rows?.length??0;
   });
  }
 });
}
