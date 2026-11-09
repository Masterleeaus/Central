import {product,environment} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Restricted, server-owned grant lookup. A client must never choose its company. */
export function createPgGrantRegistry({pool,clock=Date.now}={}){
 if(typeof pool?.connect!=='function'||typeof clock!=='function')fail('invalid_grant_pool');
 return async({clientId,application,environment:env})=>{
  if(typeof clientId!=='string'||!(/^[A-Za-z0-9:_-]{1,256}$/).test(clientId))fail('unauthorised');
  product(application);environment(env);
  const c=await pool.connect();let begun=false;
  try{
   await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
   await c.query('SET LOCAL ROLE titan_config_grant_reader');
   await c.query("SET LOCAL statement_timeout = '3000ms'");
   const result=await c.query(`SELECT product,environment,company_id,cohorts FROM titan_config.service_company_grants
    WHERE client_id=$1 AND product=$2 AND environment=$3 AND state='active'
    AND (expires_at IS NULL OR expires_at>$4) ORDER BY company_id LIMIT 2`,
    [clientId,application,env,new Date(clock()).toISOString()]);
   if(result.rows?.length!==1)fail('unauthorised');
   const row=result.rows[0];
   await c.query('COMMIT');begun=false;
   return {active:true,product:row.product,environment:row.environment,companyId:String(row.company_id),cohorts:row.cohorts??[]};
  }catch(e){if(begun)try{await c.query('ROLLBACK')}catch{}throw e}
  finally{c.release()}
 };
}
