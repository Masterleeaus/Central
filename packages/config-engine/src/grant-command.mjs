import {companyId,environment,product,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
const SERVICE=/^[A-Za-z0-9:_-]{1,256}$/;
export function validateGrantCommand(input){
 if(!input||typeof input!=='object'||!SERVICE.test(input.clientId??''))fail('invalid_grant_client');
 const app=product(input.product),env=environment(input.environment),id=companyId(input.companyId);
 if(!Array.isArray(input.cohorts)||input.cohorts.length>32)fail('invalid_cohorts');
 input.cohorts.forEach(v=>identifier(v,'cohort'));
 if(!['active','suspended','revoked'].includes(input.state))fail('invalid_grant_state');
 if(typeof input.actor!=='string'||!SERVICE.test(input.actor))fail('invalid_grant_actor');
 const expires=input.expiresAt==null?null:new Date(input.expiresAt);
 if(expires!==null&&!Number.isFinite(expires.getTime()))fail('invalid_grant_expiry');
 return Object.freeze({clientId:input.clientId,product:app,environment:env,companyId:id,
  cohorts:Object.freeze([...new Set(input.cohorts)]),state:input.state,actor:input.actor,
  expiresAt:expires?.toISOString()??null});
}
export function validateGrantTransition(input){
 const revision=input?.expectedRevision;
 if(!Number.isSafeInteger(revision)||revision<1)fail('grant_revision_conflict');
 return Object.freeze({...validateGrantCommand(input),expectedRevision:revision});
}
