import {assertConfigMigrationApproval} from './config-db-migration-gate.mjs';
import {CANONICAL_MIGRATION_ID} from '../../../packages/config-engine/src/migration-receipt-policy.mjs';
export function assertConfigStartup(env={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return false;
 assertConfigMigrationApproval(env);
 if(env.TITAN_CONFIG_CANONICAL_MIGRATION_ID!==CANONICAL_MIGRATION_ID||
 !/^[a-f0-9]{64}$/.test(env.TITAN_CONFIG_CANONICAL_MIGRATION_SHA256??''))
 throw Error('approved canonical migration receipt required');
 for(const field of ['TITAN_OIDC_ISSUER','TITAN_OIDC_JWKS_URI','TITAN_CONFIG_AUDIENCE','TITAN_CONFIG_SALT']){
  if(typeof env[field]!=='string'||env[field].length<16||env[field]==='REPLACE_ME')
   throw Error('missing configuration startup variable: '+field);
 }
 if(!env.TITAN_CONFIG_READ_DATABASE_URL||!env.TITAN_CONFIG_GRANTS_DATABASE_URL)
  throw Error('dedicated configuration database users required');
 return true;
}
