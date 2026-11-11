import {validateGrantCommand,validateGrantTransition} from './grant-command.mjs';
import {fail} from './errors.mjs';
/** Trusted operator only. Actor must derive from an authenticated principal.
 * This API does not accept raw HTTP requests or confer operator authority. */
export function createPgGrantWriter({pool}={}){
 if(typeof pool?.connect!=='function')fail('invalid_grant_pool');
 async function transact(cmd,fn){
  const client=await pool.connect();let active=false;
  try{
   await client.query('BEGIN');active=true;
   await client.query('SET LOCAL ROLE titan_config_grant_writer');
   await client.query("SET LOCAL statement_timeout = '5000ms'");
   await client.query('SELECT set_config($1,$2,true)',['titan_config.grant_actor',cmd.actor]);
   const result=await fn(client);
   await client.query('COMMIT');active=false;return result;
  }catch(e){if(active)try{await client.query('ROLLBACK')}catch{}throw e}
  finally{client.release()}
 }
 return Object.freeze({
  create:async input=>{
   const cmd=validateGrantCommand(input);
   return transact(cmd,async c=>{
    const r=await c.query(`INSERT INTO titan_config.service_company_grants
     (client_id,product,environment,company_id,cohorts,state,expires_at)
     VALUES($1,$2,$3,$4,$5::text[],$6,$7) RETURNING id,revision`,
     [cmd.clientId,cmd.product,cmd.environment,cmd.companyId,cmd.cohorts,cmd.state,cmd.expiresAt]);
    if(r.rows.length!==1)fail('grant_insert_failed');
    return {id:String(r.rows[0].id),revision:Number(r.rows[0].revision)};
   });
  },
  transition:async input=>{
   const cmd=validateGrantTransition(input);
   return transact(cmd,async c=>{
    const r=await c.query(`UPDATE titan_config.service_company_grants
     SET state=$6,cohorts=$7::text[],expires_at=$8,revision=revision+1
     WHERE client_id=$1 AND product=$2 AND environment=$3 AND company_id=$4 AND revision=$5
     RETURNING id,revision`,
     [cmd.clientId,cmd.product,cmd.environment,cmd.companyId,cmd.expectedRevision,
      cmd.state,cmd.cohorts,cmd.expiresAt]);
    if(r.rows.length!==1)fail('grant_revision_conflict');
    return {id:String(r.rows[0].id),revision:Number(r.rows[0].revision)};
   });
  }
 });
}
