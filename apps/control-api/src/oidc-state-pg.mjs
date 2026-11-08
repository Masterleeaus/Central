/** Durable one-use OIDC state store, scoped per application. The storage table is
 * independent of Logto; only a SHA-256 digest of the opaque state is stored.
 * The PKCE verifier and nonce are sealed with AES-256-GCM (oidc-state-crypto.mjs),
 * bound to application and state digest. DELETE .. RETURNING is atomic across workers.
 * pruneExpired removes rows whose TTL has passed; schedule it under a minimal DB role. */
import {createHash} from 'node:crypto';
import {createStateSealerFromEnv} from './oidc-state-crypto.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const valid = value => typeof value==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
const aadFor = (applicationId, stateDigest, field) => `titan_oidc_login_states|${applicationId}|${stateDigest}|${field}`;
export function createPostgresOidcStateStore({pool,applicationId,clock=()=>Date.now(),sealer=createStateSealerFromEnv()}={}) {
  if(!pool?.query || !['desk','field','academy'].includes(applicationId) || typeof sealer?.seal!=='function' || typeof sealer?.open!=='function')throw new TypeError('invalid OIDC state store configuration');
  return {
    async save(state,record) {
      if(!valid(state)||!valid(record?.nonce)||!valid(record?.verifier)||!valid(record?.bindingHash)||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=clock()||record.expiresAt>clock()+600_000)throw new TypeError('invalid OIDC login state');
      const stateDigest=digest(state);
      const sealedNonce=sealer.seal(record.nonce,aadFor(applicationId,stateDigest,'nonce'));
      const sealedVerifier=sealer.seal(record.verifier,aadFor(applicationId,stateDigest,'code_verifier'));
      await pool.query(`INSERT INTO titan.titan_oidc_login_states (application_id,state_digest,nonce,code_verifier,binding_hash,expires_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6::double precision / 1000))`,[applicationId,stateDigest,sealedNonce,sealedVerifier,record.bindingHash,record.expiresAt]);
    },
    async consume(state) {
      if(!valid(state))return null;
      const stateDigest=digest(state);
      const result=await pool.query(`DELETE FROM titan.titan_oidc_login_states WHERE application_id=$1 AND state_digest=$2 AND expires_at > to_timestamp($3::double precision / 1000) RETURNING nonce,code_verifier,binding_hash,expires_at`,[applicationId,stateDigest,clock()]);
      if(result.rows.length!==1)return null;
      const row=result.rows[0];
      try {
        return {
          nonce:sealer.open(row.nonce,aadFor(applicationId,stateDigest,'nonce')),
          verifier:sealer.open(row.code_verifier,aadFor(applicationId,stateDigest,'code_verifier')),
          bindingHash:row.binding_hash,
          expiresAt:new Date(row.expires_at).getTime()
        };
      } catch { return null; }
    }
  };
}
/** Deletes login-state rows whose expiry is at or before clock(). Deletes in bounded batches
 * and returns the total removed. Consume treats rows with expires_at <= now as invalid, so
 * pruning never resurrects a usable state. */
export async function pruneExpired(pool,clock=()=>Date.now(),{batchSize=1000}={}) {
  if(!pool?.query || typeof clock!=='function' || !Number.isSafeInteger(batchSize) || batchSize<1 || batchSize>10_000) throw new TypeError('invalid prune configuration');
  let total=0;
  for(;;){
    const result=await pool.query(`DELETE FROM titan.titan_oidc_login_states WHERE (application_id,state_digest) IN (SELECT application_id,state_digest FROM titan.titan_oidc_login_states WHERE expires_at <= to_timestamp($1::double precision / 1000) LIMIT $2)`,[clock(),batchSize]);
    const removed=Number(result?.rowCount??0);
    total+=removed;
    if(removed<batchSize) return total;
  }
}
