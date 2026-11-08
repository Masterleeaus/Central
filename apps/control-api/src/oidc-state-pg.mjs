/** Durable one-use OIDC state store, scoped per application. The storage table is
 * independent of Logto; only a SHA-256 digest of the opaque state is stored.
 * DELETE .. RETURNING is atomic across workers and app instances. */
import {createHash} from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const valid = value => typeof value==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
export function createPostgresOidcStateStore({pool,applicationId,clock=()=>Date.now()}={}) {
  if(!pool?.query || !['supercharged','sorted','lms'].includes(applicationId))throw new TypeError('invalid OIDC state store configuration');
  return {
    async save(state,record) {
      if(!valid(state)||!valid(record?.nonce)||!valid(record?.verifier)||!valid(record?.bindingHash)||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=clock()||record.expiresAt>clock()+600_000)throw new TypeError('invalid OIDC login state');
      await pool.query(`INSERT INTO titan_oidc_login_states (application_id,state_digest,nonce,code_verifier,binding_hash,expires_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6::double precision / 1000))`,[applicationId,digest(state),record.nonce,record.verifier,record.bindingHash,record.expiresAt]);
    },
    async consume(state) {
      if(!valid(state))return null;
      const result=await pool.query(`DELETE FROM titan_oidc_login_states WHERE application_id=$1 AND state_digest=$2 AND expires_at > to_timestamp($3::double precision / 1000) RETURNING nonce,code_verifier,binding_hash,expires_at`,[applicationId,digest(state),clock()]);
      if(result.rows.length!==1)return null;
      const row=result.rows[0];
      return {nonce:row.nonce,verifier:row.code_verifier,bindingHash:row.binding_hash,expiresAt:new Date(row.expires_at).getTime()};
    }
  };
}
