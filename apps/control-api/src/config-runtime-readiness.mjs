import {verifyRuntimeLogin} from '../../../packages/config-engine/src/pg-runtime-login-check.mjs';
import {verifyCanonicalDbAtStartup} from '../../../packages/config-engine/src/pg-canonical-startup.mjs';
import {verifyCanonicalMigrationReceipt} from '../../../packages/config-engine/src/pg-migration-receipt.mjs';
import {fail} from '../../../packages/config-engine/src/errors.mjs';
export async function verifyConfigRuntimeReadiness({runtime,env,verifyLogin=verifyRuntimeLogin,
 verifySchema=verifyCanonicalDbAtStartup,verifyReceipt=verifyCanonicalMigrationReceipt}={}){
 if(!runtime?.configPool||!runtime?.grantPool||runtime.configPool===runtime.grantPool)fail('invalid_runtime_pools');
 if(env?.TITAN_CONFIG_MIGRATION_APPROVED!=='true')fail('migration_not_approved');
 const config=await verifyLogin(runtime.configPool,'config');
 const grants=await verifyLogin(runtime.grantPool,'grants');
 await verifySchema(runtime.configPool);
 const receipt=await verifyReceipt(runtime.configPool,{
 expectedId:env.TITAN_CONFIG_CANONICAL_MIGRATION_ID,expectedHash:env.TITAN_CONFIG_CANONICAL_MIGRATION_SHA256});
 return Object.freeze({ready:true,roles:[config.login,grants.login],migrationId:receipt.migrationId});
}
