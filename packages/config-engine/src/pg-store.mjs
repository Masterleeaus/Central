import {randomUUID} from 'node:crypto';
import {scopeOf} from './scope.mjs';
import {validateDefinition} from './definition.mjs';
import {validateOverride} from './override.mjs';
import {fail} from './errors.mjs';
function definitionFrom(row) {
 if(!row)return null;
 return validateDefinition({key:row.key,owner:row.owner,product:row.product,type:row.value_type,
  defaultValue:row.default_value,allowedValues:row.allowed_values??undefined,description:row.description});
}
function overrideFrom(row) {
 return {product:row.product,environment:row.environment,
  target:row.kind==='company'?{companyId:row.scope}:row.kind==='cohort'?{cohort:row.scope}:{},
  value:row.value,percentage:row.percentage,expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,
  revision:Number(row.revision)};
}
export function createPgConfigStore({pool,correlationId=randomUUID}={}) {
 if(typeof pool?.connect!=='function'||typeof correlationId!=='function')fail('invalid_pool');
 async function tx(fn,readOnly=false) {
  const c=await pool.connect();let begun=false;
  try {
   await c.query(readOnly?'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');begun=true;
   await c.query("SET LOCAL statement_timeout = '5000ms'");
   const value=await fn(c);await c.query('COMMIT');begun=false;return value;
  }catch(e){if(begun)try{await c.query('ROLLBACK')}catch{}throw e;}finally{c.release();}
 }
 const defSql='SELECT product,key,owner,value_type,default_value,allowed_values,description FROM titan_config.definitions WHERE product=$1 AND key=$2';
 const scopeSql='product,key,environment,kind,scope';
 return Object.freeze({
  readSnapshot:({key,product,environment,companyId,cohorts=[]})=>tx(async c=>{
   const definition=definitionFrom((await c.query(defSql,[product,key])).rows[0]);
   if(!definition)return {definition:null,overrides:[]};
   const rows=await c.query(`SELECT r.* FROM titan_config.scopes s JOIN titan_config.revisions r ON
    r.product=s.product AND r.key=s.key AND r.environment=s.environment
    AND r.kind=s.kind AND r.scope=s.scope AND r.revision=s.revision
    WHERE s.product=$1 AND s.key=$2 AND s.environment=$3
    AND (s.kind='environment' OR (s.kind='company' AND s.scope=$4)
    OR (s.kind='cohort' AND s.scope=ANY($5::text[])))`,
    [product,key,environment,companyId,cohorts]);
   return {definition,overrides:rows.rows.map(overrideFrom)};
  },true),
  getDefinition:(key,product)=>tx(async c=>definitionFrom((await c.query(defSql,[product,key])).rows[0]),true),
  getOverrides:(key,product,environment)=>tx(async c=>(await c.query(
   `SELECT r.* FROM titan_config.scopes s JOIN titan_config.revisions r ON
    r.product=s.product AND r.key=s.key AND r.environment=s.environment AND r.kind=s.kind
    AND r.scope=s.scope AND r.revision=s.revision
    WHERE s.product=$1 AND s.key=$2 AND s.environment=$3`,
   [product,key,environment])).rows.map(overrideFrom),true),
  getHistoricalOverride:({key,product,environment,target={},revision})=>tx(async c=>{
   const {kind,scope}=scopeOf(target);
   const rows=(await c.query(`SELECT * FROM titan_config.revisions WHERE product=$1 AND key=$2
     AND environment=$3 AND kind=$4 AND scope=$5 AND revision=$6`,
     [product,key,environment,kind,scope,revision])).rows;
   return rows[0]?overrideFrom(rows[0]):null;
  },true),
  commitOverride:({key,override,expectedRevision,audit})=>tx(async c=>{
   if(!audit?.actorId||!audit?.reason)fail('invalid_audit');
   const {kind,scope}=scopeOf(override.target);
   const args=[override.product,key,override.environment,kind,scope];
   await c.query(`INSERT INTO titan_config.scopes (${scopeSql}) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (product,key,environment,kind,scope) DO NOTHING`,args);
   const head=(await c.query(`SELECT revision FROM titan_config.scopes WHERE product=$1 AND key=$2
     AND environment=$3 AND kind=$4 AND scope=$5 FOR UPDATE`,args)).rows[0];
   if(!head||Number(head.revision)!==expectedRevision)fail('revision_conflict');
   const def=definitionFrom((await c.query(defSql,[override.product,key])).rows[0]);
   if(!def)fail('unknown_flag');
   validateOverride(def,override);
   if(override.revision!==expectedRevision+1)fail('revision_mismatch');
   const cid=correlationId();
   if(typeof cid!=='string'||cid.length<1||cid.length>128)fail('invalid_correlation_id');
   const action=audit.action==='config_override_rolled_back'?'rollback':'set';
   await c.query(`INSERT INTO titan_config.revisions (${scopeSql},revision,value,percentage,expires_at,actor,reason,action)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
     [...args,override.revision,JSON.stringify(override.value),override.percentage,
      override.expiresAt,audit.actorId,audit.reason,action]);
   await c.query(`UPDATE titan_config.scopes SET revision=$6 WHERE product=$1 AND key=$2
     AND environment=$3 AND kind=$4 AND scope=$5`,[...args,override.revision]);
   await c.query(`INSERT INTO titan_config.audit (${scopeSql},revision,actor,reason,action,correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
     [...args,override.revision,audit.actorId,audit.reason,action,cid]);
   return {revision:override.revision,correlationId:cid};
  })
 });
}
