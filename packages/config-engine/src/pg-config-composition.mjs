import {createConfigApi} from './config-api.mjs';
import {createPgGrantRegistry} from './pg-grant-registry.mjs';
import {fail} from './errors.mjs';
/** Complete server-side, opt-in composition; separate restricted login pools
 * are required for production. Database logins must not be user-accessible. */
export function createPgAuthenticatedConfigHandler({configPool,grantPool,issuer,audience,jwksUri,fetcher,clock,salt}={}){
 if(typeof configPool?.connect!=='function'||typeof grantPool?.connect!=='function')fail('invalid_config_pools');
 const lookup=createPgGrantRegistry({pool:grantPool,clock});
 return createConfigApi({pool:configPool,lookup,issuer,audience,jwksUri,fetcher,clock,salt});
}
