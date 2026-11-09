/** Durable one-use company selection storage. Sensitive OIDC subject, issuer
 * and selected company choices are authenticated/encrypted at rest. A digest
 * of the random one-use state is the only database lookup key.
 */
import {createHash} from 'node:crypto';
import {createStateSealerFromEnv} from './oidc-state-crypto.mjs';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HASH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=value=>createHash('sha256').update(value).digest('hex');
const SUBJECT=/^[^\\s\\x00-\\x1f\\x7f]{1,256}$/u;
const validIssuer=value=>{try{const x=new URL(value);return x.protocol==='https:'&&!x.username&&!x.password&&!x.search&&!x.hash&&x.href===value;}catch{return false;}};
const aad=(stateDigest,field)=>'central_company_selection|'+stateDigest+'|'+field;
async function transaction(pool,task){
  const client=await pool.connect();let begun=false;
  try{
    await client.query('BEGIN');begun=true;
    await client.query('SET LOCAL ROLE titan_central_selection');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result=await task(client);
    await client.query('COMMIT');begun=false;
    return result;
  }catch(error){
    if(begun)try{await client.query('ROLLBACK');}catch{/* preserve original */}
    throw error;
  }finally{client.release?.();}
}
export function createPostgresCompanySelectionStore({pool,sealer=createStateSealerFromEnv(),clock=()=>Date.now()}={}){
  if(typeof pool?.connect!=='function'||typeof sealer?.seal!=='function'||
    typeof sealer?.open!=='function'||typeof clock!=='function')
    throw new TypeError('trusted selection store dependencies required');
  return Object.freeze({
    async save(state,record){
      if(!TOKEN.test(state??'')||!record||!validIssuer(record.issuer)||
        typeof record.subject!=='string'||!SUBJECT.test(record.subject)||!HASH.test(record.bindingHash??'')||
        !Array.isArray(record.organisationIds)||record.organisationIds.length===0||
        record.organisationIds.length>128||!record.organisationIds.every(id=>typeof id==='string'&&UUID.test(id))||
        new Set(record.organisationIds).size!==record.organisationIds.length||
        !Number.isSafeInteger(record.expiresAt)||record.expiresAt<=clock()||
        record.expiresAt>clock()+600000)throw new TypeError('invalid selection state');
      const key=digest(state);
      const sealedIssuer=sealer.seal(record.issuer,aad(key,'issuer'));
      const sealedSubject=sealer.seal(record.subject,aad(key,'subject'));
      const sealedIds=sealer.seal(JSON.stringify(record.organisationIds),aad(key,'companies'));
      await transaction(pool,async client=>{
        const result=await client.query(
          'INSERT INTO titan.central_company_selection_states (state_digest,binding_hash,sealed_issuer,sealed_subject,sealed_company_ids,expires_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6::double precision / 1000)) RETURNING state_digest',
          [key,record.bindingHash,sealedIssuer,sealedSubject,sealedIds,record.expiresAt]);
        if(result.rows.length!==1)throw Error('selection state not stored');
      });
    },
    async consume(state){
      if(!TOKEN.test(state??''))return null;
      const key=digest(state);
      return transaction(pool,async client=>{
        const result=await client.query(
          'DELETE FROM titan.central_company_selection_states WHERE state_digest=$1 AND expires_at > to_timestamp($2::double precision / 1000) RETURNING binding_hash,sealed_issuer,sealed_subject,sealed_company_ids,expires_at',
          [key,clock()]);
        if(result.rows.length!==1)return null;
        try{
          const row=result.rows[0];
          const issuer=sealer.open(row.sealed_issuer,aad(key,'issuer'));
          const subject=sealer.open(row.sealed_subject,aad(key,'subject'));
          const organisationIds=JSON.parse(sealer.open(row.sealed_company_ids,aad(key,'companies')));
          if(!validIssuer(issuer)||!SUBJECT.test(subject))return null;
          if(!Array.isArray(organisationIds)||organisationIds.length===0||organisationIds.length>128||
            !organisationIds.every(id=>typeof id==='string'&&UUID.test(id))||
            new Set(organisationIds).size!==organisationIds.length||!HASH.test(row.binding_hash))return null;
          return {issuer,subject,organisationIds,bindingHash:row.binding_hash,expiresAt:new Date(row.expires_at).getTime()};
        }catch{return null;}
      });
    },
    async prune({limit=500}={}){
      if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new TypeError('invalid prune limit');
      return transaction(pool,async client=>{
        const result=await client.query(
          'DELETE FROM titan.central_company_selection_states WHERE state_digest IN (SELECT state_digest FROM titan.central_company_selection_states WHERE expires_at <= now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING state_digest',[limit]);
        return result.rows.length;
      });
    }
  });
}
