import {assertAuthoritativeGrant} from '../../../packages/config-engine/src/config-client-context.mjs';
import {fail} from '../../../packages/config-engine/src/errors.mjs';
/** fetchGrant must consult server-managed grants, never untrusted claims. */
export function createConfigGrantReader({fetchGrant}={}){
 if(typeof fetchGrant!=='function')fail('invalid_grant_reader');
 return async ({clientId,application,environment})=>{
  if(typeof clientId!=='string'||!/^[a-zA-Z0-9:_-]{1,256}$/.test(clientId))fail('unauthorised');
  const record=await fetchGrant({clientId,application,environment});
  return Object.freeze({...assertAuthoritativeGrant(record,application,environment),active:true});
 };
}
