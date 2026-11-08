/** Durable Central browser sessions, accessed through the dedicated
 * titan_central_sessions database role. No raw session token enters SQL.
 * SET LOCAL ROLE is transactional and never persists on pooled connections.
 */
const DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT=/^[^\s\x00-\x1f\x7f]{1,256}$/u;
function verifyDigest(d){if(typeof d!=='string'||!DIGEST.test(d))throw new TypeError('invalid token digest');}
const expiryDate=value=>{
  if(!Number.isSafeInteger(value))throw new TypeError('invalid session expiry');
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new TypeError('invalid session expiry');
  return date.toISOString();
};
async function sessionTransaction(pool,fn){
  const client=await pool.connect();
  let begun=false;
  try{
    await client.query('BEGIN');begun=true;
    await client.query('SET LOCAL ROLE titan_central_sessions');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result=await fn(client);
    await client.query('COMMIT');begun=false;
    return result;
  }catch(error){
    if(begun)try{await client.query('ROLLBACK');}catch{/* original error wins */}
    throw error;
  }finally{client.release?.();}
}
export function createPostgresCentralSessionStore({pool}={}){
  if(typeof pool?.connect!=='function')throw new TypeError('PostgreSQL connection pool required');
  return Object.freeze({
    async insert({digest,identityId,companyId,expiresAt}={}){
      verifyDigest(digest);
      if(typeof identityId!=='string'||!SUBJECT.test(identityId)||typeof companyId!=='string'||!UUID.test(companyId))throw new TypeError('invalid session principal');
      const when=expiryDate(expiresAt);
      return sessionTransaction(pool,async client=>{
        const result=await client.query(
          'SELECT titan.central_issue_browser_session($1,$2,$3,$4::timestamptz) AS token_digest',
          [digest,identityId,companyId,when]);
        if(result.rows?.length!==1)throw new Error('session insert not confirmed');
      });
    },
    async find(digest){
      verifyDigest(digest);
      return sessionTransaction(pool,async client=>{
        const result=await client.query(
          'SELECT logto_subject, organisation_id, expires_at FROM titan.central_browser_sessions WHERE token_digest=$1 AND expires_at > now()',
          [digest]);
        if(result.rows.length>1)throw new Error('ambiguous session');
        const row=result.rows[0];
        return row?{identityId:row.logto_subject,companyId:row.organisation_id,expiresAt:new Date(row.expires_at).getTime()}:null;
      });
    },
    /** Returns true only if this caller atomically revoked an existing session.
     * Concurrent company rotations cannot both consume the same old digest. */
    async delete(digest){
      verifyDigest(digest);
      return sessionTransaction(pool,async client=>{
        const result=await client.query(
          'DELETE FROM titan.central_browser_sessions WHERE token_digest=$1 RETURNING token_digest',[digest]);
        if(result.rows.length>1)throw new Error('ambiguous session deletion');
        return result.rows.length===1;
      });
    },
    async prune({limit=500}={}){
      if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new TypeError('invalid prune limit');
      return sessionTransaction(pool,async client=>{
        const result=await client.query(
          'DELETE FROM titan.central_browser_sessions WHERE token_digest IN (SELECT token_digest FROM titan.central_browser_sessions WHERE expires_at <= now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING token_digest',
          [limit]);
        return result.rows.length;
      });
    }
  });
}
