import {fail} from './errors.mjs';
import {product,environment} from './identifiers.mjs';
import {assertAuthoritativeGrant} from './config-client-context.mjs';
/** The registry must read authoritative server-managed membership, never token tenant claims. */
export function createServiceRegistry({lookup}={}){
 if(typeof lookup!=='function')fail('invalid_service_registry');
 return async function resolveCompany(principal,application,env){
  product(application);environment(env);
  if(principal?.authenticated!==true||principal.kind!=='service'||!principal.clientId)fail('unauthorised');
  const grant=await lookup({clientId:principal.clientId,application,environment:env});
  return assertAuthoritativeGrant(grant,application,env);
 };
}
