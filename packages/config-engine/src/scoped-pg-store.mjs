import {runScopedTransaction} from './scoped-transaction.mjs';
import {validateDefinition} from './definition.mjs';
import {validateOverride} from './override.mjs';
import {companyId,identifier,environment,product} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Trusted M2M read-only repository. Each request gets a fresh transaction,
 * a restricted Postgres role and an immutable company/cohort context.
 * No raw SQL or transaction handles are exposed to product clients. */
export function createScopedPgConfigStore({pool}={}) {
 if(typeof pool?.connect!=='function')fail('invalid_pool');
 return Object.freeze({readSnapshot:async ({key,product:app,environment:env,companyId:id,cohorts=[]})=>{
  identifier(key,'key');product(app);environment(env);companyId(id);
  return runScopedTransaction(pool,{companyId:id,cohorts},async c=>{
   const result=await c.query('SELECT product,key,owner,value_type,default_value,allowed_values,description FROM titan_config.definitions WHERE product=$1 AND key=$2',[app,key]);
   if(result.rows.length!==1)return {definition:null,overrides:[]};
   const d=result.rows[0];
   const definition=validateDefinition({key:d.key,product:d.product,owner:d.owner,type:d.value_type,
    defaultValue:d.default_value,allowedValues:d.allowed_values??undefined,description:d.description});
   const rows=await c.query(`SELECT r.* FROM titan_config.scopes s
    JOIN titan_config.revisions r ON r.product=s.product AND r.key=s.key AND r.environment=s.environment
     AND r.kind=s.kind AND r.scope=s.scope AND r.revision=s.revision
    WHERE s.product=$1 AND s.key=$2 AND s.environment=$3
     AND (s.kind='environment' OR (s.kind='company' AND s.scope=$4)
      OR (s.kind='cohort' AND s.scope=ANY($5::text[])))`,[app,key,env,id,cohorts]);
   const overrides=rows.rows.map(r=>validateOverride(definition,{
    product:r.product,environment:r.environment,target:r.kind==='company'?{companyId:r.scope}:r.kind==='cohort'?{cohort:r.scope}:{},
    value:r.value,percentage:r.percentage,revision:Number(r.revision),
    expiresAt:r.expires_at?new Date(r.expires_at).toISOString():null}));
   return {definition,overrides};
  });
 }});
}
