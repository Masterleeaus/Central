import {fail} from './errors.mjs';
const logins=Object.freeze({config:'titan_config_api_login',grants:'titan_config_grants_login',
 writer:'titan_config_grant_admin_login',authority:'titan_config_authority_login'});
export function loginForPurpose(purpose){
 if(!Object.hasOwn(logins,purpose))fail('invalid_db_purpose');
 return logins[purpose];
}
export function assertIndependentServicePools(pools){
 if(!pools||typeof pools!=='object')fail('invalid_db_pools');
 const selected=Object.keys(logins).map(k=>pools[k]);
 if(selected.some(x=>typeof x?.connect!=='function')||new Set(selected).size!==4)fail('shared_privileged_pool');
 return Object.freeze({...pools});
}
