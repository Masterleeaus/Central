import {product,environment} from './identifiers.mjs';
import {fail} from './errors.mjs';
import {requireOneActiveGrant} from './grant-result.mjs';
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
   const result=await c.query(`SELECT g.product,g.environment,g.company_id,g.cohorts,g.state,c.status AS company_status
    FROM titan_config.service_company_grants g JOIN titan.companies c ON c.id=g.company_id
    WHERE g.client_id=$1 AND g.product=$2 AND g.environment=$3 AND g.state='active'
    AND c.status='active' AND (g.expires_at IS NULL OR g.expires_at>$4)
    ORDER BY g.company_id LIMIT 2`,
    [clientId,application,env,new Date(clock()).toISOString()]);
   const row=requireOneActiveGrant(result.rows);
   await c.query('COMMIT');begun=false;
   return {active:true,product:row.product,environment:row.environment,companyId:String(row.company_id),cohorts:row.cohorts??[]};
  }catch(e){if(begun)try{await c.query('ROLLBACK')}catch{}throw e}
  finally{c.release()}
 };
}
