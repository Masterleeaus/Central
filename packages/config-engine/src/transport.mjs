import {verifiedContext} from './verified-context.mjs';
import {readTenantFlag} from './read-model.mjs';
import {fail} from './errors.mjs';
/** Integration callback MUST verify signed M2M token, audience and tenant.
 * The browser is not permitted to supply a company ID or cohort. */
export function createConfigReadTransport({authenticate,resolveCompany,store,salt,clock=Date.now}={}){
 if(typeof authenticate!=='function'||typeof resolveCompany!=='function'||
    typeof store?.readSnapshot!=='function'||typeof salt!=='string'||salt.length<16)fail('invalid_transport');
 return async ({authorization,key,application,environment})=>{
  const principal=await authenticate(authorization);
  if(principal?.kind!=='service'||principal.authenticated!==true)fail('unauthorised');
  const trusted=await resolveCompany(principal,application,environment);
  if(trusted?.product!==application||trusted?.environment!==environment)fail('untrusted_context');
  const context=verifiedContext({principal,product:application,environment,
    companyId:trusted.companyId,cohorts:trusted.cohorts??[]});
  return readTenantFlag({store,key,context,salt,now:clock()});
 };
}
