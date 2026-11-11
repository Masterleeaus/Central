export function assertConfigMigrationApproval(env={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return false;
 if(env.TITAN_CONFIG_MIGRATION_APPROVED!=='true')throw Error('canonical company migrations are not approved');
 return true;
}
