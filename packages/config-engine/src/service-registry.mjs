import {fail} from './errors.mjs';
import {product,environment,companyId,identifier} from './identifiers.mjs';
/** The registry must read authoritative server-managed membership, never token tenant claims. */
export function createServiceRegistry({lookup}={}){
 if(typeof lookup!=='function')fail('invalid_service_registry');
 return async function resolveCompany(principal,application,env){
  product(application);environment(env);
  if(principal?.authenticated!==true||principal.kind!=='service'||!principal.clientId)fail('unauthorised');
  const grant=await lookup({clientId:principal.clientId,application,environment:env});
  if(!grant||grant.active!==true||grant.product!==application||grant.environment!==env)fail('unauthorised');
  const id=companyId(grant.companyId);
  if(!Array.isArray(grant.cohorts)||grant.cohorts.length>32)fail('invalid_cohorts');
  grant.cohorts.forEach(c=>identifier(c,'cohort'));
  return Object.freeze({product:application,environment:env,companyId:id,cohorts:[...new Set(grant.cohorts)]});
 };
}
