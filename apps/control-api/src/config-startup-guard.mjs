import {assertConfigMigrationApproval} from './config-db-migration-gate.mjs';
export function assertConfigStartup(env={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return false;
 assertConfigMigrationApproval(env);
 for(const field of ['TITAN_OIDC_ISSUER','TITAN_OIDC_JWKS_URI','TITAN_CONFIG_AUDIENCE','TITAN_CONFIG_SALT']){
  if(typeof env[field]!=='string'||env[field].length<16||env[field]==='REPLACE_ME')
   throw Error('missing configuration startup variable: '+field);
 }
 if(!env.TITAN_CONFIG_READ_DATABASE_URL||!env.TITAN_CONFIG_GRANTS_DATABASE_URL)
  throw Error('dedicated configuration database users required');
 return true;
}
