import {companyId,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Trusted backend only: database session settings are local to transaction.
 * These GUCs are NOT an auth boundary against clients with arbitrary SQL access. */
export async function runScopedTransaction(pool,{companyId:id,cohorts=[]},fn){
 if(typeof pool?.connect!=='function'||typeof fn!=='function')fail('invalid_pool');
 const canonical=companyId(id);
 if(!Array.isArray(cohorts)||cohorts.length>32)fail('invalid_cohorts');
 cohorts.forEach(c=>identifier(c,'cohort'));
 const c=await pool.connect();let active=false;
 try {
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  await c.query('SET LOCAL ROLE titan_config_reader');
  await c.query("SET LOCAL statement_timeout = '5000ms'");
  await c.query('SELECT set_config($1,$2,true)', ['titan_config.company_id',canonical]);
  await c.query('SELECT set_config($1,$2,true)', ['titan_config.cohorts',[...new Set(cohorts)].join(',')]);
  const value=await fn(c);await c.query('COMMIT');active=false;return value;
 }catch(e){if(active)try{await c.query('ROLLBACK')}catch{}throw e}
 finally{c.release()}
}
