import {identifier,product,environment} from './identifiers.mjs';
import {scopeOf} from './scope.mjs';
import {requireConfigAuthority} from './authority.mjs';
import {fail} from './errors.mjs';
export function createHistoryReader({pool}={}){
 if(typeof pool?.query!=='function')fail('invalid_history_pool');
 return async ({actor,key,product:app,environment:env,target={},limit=30})=>{
  identifier(key,'key');product(app);environment(env);
  requireConfigAuthority({actor,action:'read',product:app,environment:env});
  if(!Number.isInteger(limit)||limit<1||limit>100)fail('invalid_limit');
  const {kind,scope}=scopeOf(target);
  const result=await pool.query(`SELECT revision,action,created_at,correlation_id
   FROM titan_config.audit WHERE product=$1 AND key=$2 AND environment=$3 AND kind=$4 AND scope=$5
   ORDER BY revision DESC LIMIT $6`,[app,key,env,kind,scope,limit]);
  return result.rows.map(r=>({revision:Number(r.revision),action:r.action,createdAt:r.created_at,correlationId:r.correlation_id}));
 };
}
