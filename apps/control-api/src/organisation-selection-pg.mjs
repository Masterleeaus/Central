/** Durable one-use store for pending organisation selections (issue #32), backed by migration 0016.
 * Implements the store contract used by oidc-http-adapter.mjs: save(record) and consume(bindingHash).
 * Only digests of the browser binding, the OIDC state and the selection token are written. The raw values never reach the database.
 * Every statement runs in its own transaction as titan_trusted_writer (role-transaction.mjs).
 * consume is a single UPDATE that claims the row only while it is unconsumed and unexpired, so it is one-use across workers.
 * Fail closed: malformed input never reaches the database, malformed rows read back return null,
 * and any database error propagates so the adapter refuses the selection (503 on consume, 401 on save).
 * pruneExpiredSelections removes expired and consumed rows. Schedule it under the same narrow writer role. */
import {withRoleTransaction} from './role-transaction.mjs';
const WRITER='titan_trusted_writer';
const APPLICATIONS=new Set(['desk','field','academy']);
const DIGEST=/^[A-Za-z0-9_-]{43}$/;
const ORGANISATION_ID=/^[A-Za-z0-9:_-]{1,200}$/;
const TTL_LIMIT_MS=600_000;
const MAX_ORGANISATIONS=128;
const MAX_SEALED_LENGTH=32768;
const validRecord=(record,applicationId,clock)=>
  record && typeof record==='object' &&
  DIGEST.test(record.bindingHash) && DIGEST.test(record.stateDigest) && DIGEST.test(record.selectionHash) &&
  typeof record.issuer==='string' && record.issuer.length>=1 && record.issuer.length<=512 &&
  typeof record.subject==='string' && record.subject.length>=1 && record.subject.length<=255 &&
  Array.isArray(record.organisationIds) && record.organisationIds.length>=2 && record.organisationIds.length<=MAX_ORGANISATIONS &&
  record.organisationIds.every(id=>typeof id==='string' && ORGANISATION_ID.test(id)) &&
  new Set(record.organisationIds).size===record.organisationIds.length &&
  (record.sealedIdToken===null || (typeof record.sealedIdToken==='string' && record.sealedIdToken.length>=1 && record.sealedIdToken.length<=MAX_SEALED_LENGTH)) &&
  Number.isSafeInteger(record.expiresAt) && record.expiresAt>clock() && record.expiresAt<=clock()+TTL_LIMIT_MS &&
  APPLICATIONS.has(applicationId);

export function createPostgresOrganisationSelectionStore({pool,applicationId,clock=()=>Date.now()}={}) {
  if(typeof pool?.connect!=='function' || !APPLICATIONS.has(applicationId) || typeof clock!=='function')throw new TypeError('invalid organisation selection store configuration');
  return {
    async save(record) {
      if(!validRecord(record,applicationId,clock))throw new TypeError('invalid organisation selection');
      await withRoleTransaction(pool,WRITER,conn=>conn.query(
        `INSERT INTO titan.titan_oidc_organisation_selections (application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::double precision / 1000))`,
        [applicationId,record.bindingHash,record.stateDigest,record.selectionHash,record.issuer,record.subject,record.organisationIds,record.sealedIdToken,record.expiresAt]));
    },
    async consume(bindingHash) {
      if(typeof bindingHash!=='string' || !DIGEST.test(bindingHash))return null;
      const now=clock();
      const result=await withRoleTransaction(pool,WRITER,conn=>conn.query(
        `WITH claimed AS (
           SELECT application_id,binding_hash,state_digest,selection_hash,issuer,subject,organisation_ids,sealed_id_token,expires_at
           FROM titan.titan_oidc_organisation_selections
           WHERE application_id=$1 AND binding_hash=$2 AND consumed_at IS NULL AND expires_at > to_timestamp($3::double precision / 1000)
           FOR UPDATE
         )
         UPDATE titan.titan_oidc_organisation_selections AS s
         SET consumed_at=to_timestamp($3::double precision / 1000), sealed_id_token=NULL
         FROM claimed c
         WHERE s.application_id=c.application_id AND s.binding_hash=c.binding_hash
         RETURNING c.state_digest,c.selection_hash,c.issuer,c.subject,c.organisation_ids,c.sealed_id_token,c.expires_at`,
        [applicationId,bindingHash,now]));
      if(result.rows.length!==1)return null;
      const row=result.rows[0];
      if(!Array.isArray(row.organisation_ids) || !DIGEST.test(row.state_digest) || !DIGEST.test(row.selection_hash))return null;
      const expiresAt=new Date(row.expires_at).getTime();
      if(!Number.isSafeInteger(expiresAt))return null;
      return {
        bindingHash,
        stateDigest:row.state_digest,
        selectionHash:row.selection_hash,
        issuer:row.issuer,
        subject:row.subject,
        organisationIds:[...row.organisation_ids],
        sealedIdToken:row.sealed_id_token??null,
        expiresAt
      };
    }
  };
}

/** Deletes selections that have expired or been consumed. Bounded batches, each its own transaction as titan_trusted_writer.
 * A consumed row is never revived by pruning: consume requires a row with consumed_at IS NULL, and save cannot reuse a binding or state. */
export async function pruneExpiredSelections(pool,clock=()=>Date.now(),{batchSize=1000}={}) {
  if(typeof pool?.connect!=='function' || typeof clock!=='function' || !Number.isSafeInteger(batchSize) || batchSize<1 || batchSize>10_000) throw new TypeError('invalid prune configuration');
  let total=0;
  for(;;){
    const result=await withRoleTransaction(pool,WRITER,conn=>conn.query(
      `DELETE FROM titan.titan_oidc_organisation_selections
       WHERE (application_id,binding_hash) IN (
         SELECT application_id,binding_hash FROM titan.titan_oidc_organisation_selections
         WHERE expires_at <= to_timestamp($1::double precision / 1000) OR consumed_at IS NOT NULL
         LIMIT $2)`,
      [clock(),batchSize]));
    const removed=Number(result?.rowCount??0);
    total+=removed;
    if(removed<batchSize) return total;
  }
}
