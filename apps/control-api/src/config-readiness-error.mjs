export function safeConfigReadinessFailure(error){
 const permitted=new Set(['unsafe_runtime_login','invalid_runtime_pools','migration_not_approved','canonical_migration_checksum_mismatch','missing_canonical_migration_receipt']);
 const code=permitted.has(error?.code)?error.code:'config_readiness_failed';
 return Object.freeze({error:'config_readiness_failed',code});
}
