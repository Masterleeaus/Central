import {fail} from './errors.mjs';
export function assertCanonicalIntegrationReadiness({schemaVerified,restrictedRolesVerified,signedJwtVerified,approvedMigration}={}){
 if([schemaVerified,restrictedRolesVerified,signedJwtVerified,approvedMigration].some(x=>x!==true))fail('canonical_integration_unapproved');
 return true;
}
