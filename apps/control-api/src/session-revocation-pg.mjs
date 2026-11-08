/** PostgreSQL implementation of a generation counter for session revocation.
 * A version increment invalidates all app sessions bound to that user+org+app.
 * Each statement runs in a transaction under a restricted role (role-transaction.mjs):
 * readVersion as titan_trusted_reader, revokeAll as titan_trusted_writer (migrations 0007-0009).
 * Writes must be called exclusively after trusted administrator authority checks.
 */
import {withRoleTransaction} from './role-transaction.mjs';
const APPS=new Set(['desk','field','academy']);
const ID=/^[A-Za-z0-9:_-]{1,200}$/;
const check=({applicationId,logtoSubject,organisationId})=>{
  if(!APPS.has(applicationId)||![logtoSubject,organisationId].every(v=>typeof v==='string'&&ID.test(v)))throw new TypeError('invalid revocation scope');
};
export function createPostgresSessionRevocations({pool}={}) {
  if(typeof pool?.connect!=='function')throw new TypeError('database pool required');
  return {
    async readVersion(args){
      check(args);
      const result=await withRoleTransaction(pool,'titan_trusted_reader',conn=>conn.query('SELECT generation FROM titan.titan_session_revocations WHERE application_id=$1 AND logto_subject=$2 AND organisation_id=$3',[args.applicationId,args.logtoSubject,args.organisationId]));
      if(result.rows.length>1)throw new Error('ambiguous revocation record');
      const value=result.rows.length===0?0:Number(result.rows[0].generation);
      if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid revocation generation');
      return value;
    },
    async revokeAll(args){
      check(args);
      const result=await withRoleTransaction(pool,'titan_trusted_writer',conn=>conn.query(`INSERT INTO titan.titan_session_revocations (application_id,logto_subject,organisation_id,generation)
VALUES ($1,$2,$3,1) ON CONFLICT (application_id,logto_subject,organisation_id)
DO UPDATE SET generation=titan_session_revocations.generation+1,revoked_at=now()
RETURNING generation`,[args.applicationId,args.logtoSubject,args.organisationId]));
      const value=Number(result.rows[0]?.generation);
      if(!Number.isSafeInteger(value)||value<1)throw new Error('revocation not confirmed');
      return value;
    }
  };
}
