/** Central-owned OIDC login-state store. Reuses AES-GCM state sealing, one-use
 * DELETE RETURNING and digest-only state keys from the established adapter,
 * but executes every statement under an isolated transaction-local DB role.
 */
import {createPostgresOidcStateStore} from './oidc-state-pg.mjs';
export function createCentralOidcStateStore({pool,sealer,clock}={}){
  if(typeof pool?.connect!=='function')throw new TypeError('database connection pool required');
  const restricted={
    async query(sql,parameters){
      const client=await pool.connect();
      let begun=false;
      try{
        await client.query('BEGIN');begun=true;
        await client.query('SET LOCAL ROLE titan_central_oidc');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const result=await client.query(sql,parameters);
        await client.query('COMMIT');begun=false;
        return result;
      }catch(error){
        if(begun)try{await client.query('ROLLBACK');}catch{/* preserve original exception */}
        throw error;
      }finally{client.release?.();}
    }
  };
  return createPostgresOidcStateStore({
    pool:restricted,applicationId:'central',
    ...(sealer?{sealer}:{}),...(clock?{clock}:{})
  });
}
